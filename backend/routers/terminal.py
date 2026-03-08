"""
Octofleet API - Terminal Routes
"""
import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from auth import decode_token, get_current_user
from dependencies import API_KEY, db_pool, verify_api_key
from screen_session import ScreenSessionState, screen_session_manager
from shell_session import ShellSessionState, shell_session_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Terminal"])

# In-memory terminal sessions (simple polling-based terminals)
_terminal_sessions: dict = {}


class TerminalSession:
    def __init__(self, session_id: str, node_id: str, shell: str):
        self.session_id = session_id
        self.node_id = node_id
        self.shell = shell
        self.pending_commands: list = []
        self.output_buffer: list = []
        self.connected = False
        from datetime import datetime
        self.created_at = datetime.utcnow()


async def log_audit(pool, action: str, user_id: str = None, resource_type: str = None, resource_id: str = None, details: dict = None):
    """Log an audit event to the database."""
    import json as _json
    from uuid import UUID
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
                   VALUES ($1, $2, $3, $4, $5)""",
                UUID(user_id) if user_id and user_id != "system" else None,
                action, resource_type, resource_id,
                _json.dumps(details) if details else None
            )
    except Exception as e:
        logger.warning(f"Failed to log audit event: {e}")


async def _validate_ws_token(websocket: WebSocket) -> Optional[dict]:
    """Validate JWT token from WebSocket query params. Returns payload or None (after closing)."""
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Authentication required")
        return None
    try:
        payload = decode_token(token)
        return payload
    except Exception:
        await websocket.close(code=1008, reason="Invalid token")
        return None


@router.post("/api/v1/screen/start/{node_id}")
async def start_screen_session(
    node_id: str,
    quality: str = "medium",
    max_fps: int = 15,
    resolution: str = "auto",
    monitor: int = 0,
    user: dict = Depends(get_current_user)
):
    """
    Start a screen viewing session for a node.
    
    The session enters PENDING state until the agent connects.
    """
    try:
        session = await screen_session_manager.create_session(
            node_id=node_id.upper(),
            user_id=user.id,
            quality=quality,
            max_fps=max_fps,
            resolution=resolution,
            monitor_index=monitor
        )
        
        # Log audit event
        await log_audit(
            db_pool, 
            action="screen_session_start",
            user_id=user.id,
            resource_type="screen_session",
            resource_id=session.id,
            details={"node_id": node_id, "quality": quality}
        )
        
        return {
            "session_id": session.id,
            "state": session.state.value,
            "node_id": session.node_id,
            "websocket_url": f"/api/v1/screen/ws/{session.id}"
        }
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/api/v1/screen/sessions")
async def list_screen_sessions(_: str = Depends(verify_api_key)):
    """List all active screen sessions."""
    return {
        "sessions": screen_session_manager.list_sessions(),
        "count": len([s for s in screen_session_manager.sessions.values() 
                     if s.state != ScreenSessionState.CLOSED])
    }


@router.get("/api/v1/screen/session/{session_id}")
async def get_screen_session(session_id: str, _: str = Depends(verify_api_key)):
    """Get details of a screen session."""
    session = screen_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "id": session.id,
        "node_id": session.node_id,
        "user_id": session.user_id,
        "state": session.state.value,
        "quality": session.quality,
        "max_fps": session.max_fps,
        "resolution": session.resolution,
        "monitor_index": session.monitor_index,
        "created_at": session.created_at.isoformat(),
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "frames_sent": session.frames_sent,
        "bytes_sent": session.bytes_sent
    }


@router.delete("/api/v1/screen/session/{session_id}")
async def stop_screen_session(
    session_id: str, 
    user: dict = Depends(get_current_user)
):
    """Stop a screen viewing session."""
    success = await screen_session_manager.close_session(session_id, "user_request")
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await log_audit(
        db_pool,
        action="screen_session_stop",
        user_id=user.id,
        resource_type="screen_session",
        resource_id=session_id
    )
    
    return {"status": "stopped", "session_id": session_id}


@router.get("/api/v1/screen/pending/{node_id}")
async def get_pending_screen_session(node_id: str):
    """
    Agent endpoint: Check if there's a pending screen session for this node.
    
    Agent polls this to know when to start capturing.
    """
    session = screen_session_manager.get_pending_session_for_node(node_id.upper())
    if not session:
        return {"pending": False}
    
    return {
        "pending": True,
        "session_id": session.id,
        "quality": session.quality,
        "max_fps": session.max_fps,
        "resolution": session.resolution,
        "monitor_index": session.monitor_index,
        "websocket_url": f"/api/v1/screen/ws/agent/{session.id}"
    }


@router.websocket("/api/v1/screen/ws/{session_id}")
async def screen_viewer_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for browser viewers to receive screen frames.
    
    Protocol:
    - Server sends: {"type": "frame", "data": "<base64 jpeg>"} 
    - Server sends: {"type": "info", "resolution": "1920x1080", "fps": 15}
    - Server sends: {"type": "closed", "reason": "..."}
    """
    # Auth check before accept
    user_payload = await _validate_ws_token(websocket)
    if user_payload is None:
        return

    await websocket.accept()
    logger.info(f"Viewer WebSocket connected for session {session_id}")
    
    session = screen_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Viewer tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    session.viewer_ws = websocket
    logger.info(f"Viewer connected to screen session {session_id}, state={session.state}")
    
    try:
        # Send initial info
        await websocket.send_json({
            "type": "info",
            "session_id": session_id,
            "node_id": session.node_id,
            "state": session.state.value,
            "quality": session.quality
        })
        
        # Keep connection alive - just wait for messages, frames are pushed by agent handler
        # Use a longer timeout and don't break on timeout
        while True:
            try:
                # Wait for client messages (pings, control messages)
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    logger.debug(f"Viewer ping/pong for session {session_id}")
                elif data.get("type") == "stop":
                    logger.info(f"Viewer requested stop for session {session_id}")
                    break
            except asyncio.TimeoutError:
                # Send keep-alive ping to browser - but don't break if it fails
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception as e:
                    logger.warning(f"Failed to send ping to viewer {session_id}: {e}")
                    break
                
    except WebSocketDisconnect:
        logger.info(f"Viewer disconnected from screen session {session_id}")
    except Exception as e:
        logger.error(f"Viewer WebSocket error for {session_id}: {e}")
    finally:
        logger.info(f"Viewer WebSocket cleanup for session {session_id}")
        session.viewer_ws = None


@router.websocket("/api/v1/screen/ws/agent/{session_id}")
async def screen_agent_websocket(websocket: WebSocket, session_id: str, api_key: str = None):
    """
    WebSocket endpoint for agents to send screen frames.
    
    Protocol:
    - Agent sends: {"type": "frame", "data": "<base64 jpeg>", "width": 1920, "height": 1080}
    - Agent sends: {"type": "ready"} when capture started
    - Server sends: {"type": "stop"} to end session
    """
    logger.info(f"Agent WebSocket connecting for session {session_id}")
    
    # Validate API key (use centralized constant from dependencies)
    if api_key != API_KEY:
        logger.warning(f"Agent WebSocket rejected: invalid API key for session {session_id}")
        await websocket.close(code=4001, reason="Invalid API key")
        return
    
    await websocket.accept()
    logger.info(f"Agent WebSocket accepted for session {session_id}")
    
    session = screen_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Agent tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    if session.state != ScreenSessionState.PENDING:
        logger.warning(f"Agent tried to connect to session {session_id} but state is {session.state}")
        await websocket.send_json({"type": "error", "message": f"Session not in pending state (is {session.state})"})
        await websocket.close()
        return
    
    session.agent_ws = websocket
    await screen_session_manager.activate_session(session_id)
    logger.info(f"Agent connected to screen session {session_id}")
    
    try:
        # Send config
        await websocket.send_json({
            "type": "config",
            "quality": session.quality,
            "max_fps": session.max_fps,
            "resolution": session.resolution,
            "monitor_index": session.monitor_index
        })
        
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "frame":
                session.frames_sent += 1
                session.bytes_sent += len(data.get("data", ""))
                
                # Forward to viewer
                if session.viewer_ws:
                    try:
                        await session.viewer_ws.send_json(data)
                    except:
                        pass  # Viewer disconnected
                        
            elif data.get("type") == "ready":
                logger.info(f"Agent ready for screen capture: {session_id}")
                if session.viewer_ws:
                    await session.viewer_ws.send_json({
                        "type": "info",
                        "state": "active",
                        "message": "Agent started capturing"
                    })
                    
    except WebSocketDisconnect:
        logger.info(f"Agent disconnected from screen session {session_id}")
    except Exception as e:
        logger.error(f"Agent WebSocket error: {e}")
    finally:
        session.agent_ws = None
        await screen_session_manager.close_session(session_id, "agent_disconnected")
        
        # Notify viewer
        if session.viewer_ws:
            try:
                await session.viewer_ws.send_json({
                    "type": "closed",
                    "reason": "Agent disconnected"
                })
            except:
                pass


@router.post("/api/v1/shell/start/{node_id}")
async def start_shell_session(
    node_id: str,
    shell_type: str = "powershell",  # powershell, cmd, bash
    user: dict = Depends(get_current_user)
):
    """
    Start a remote shell session for a node.
    
    The session enters PENDING state until the agent connects.
    """
    import uuid
    
    # Validate shell type
    valid_shells = ["powershell", "cmd", "bash", "sh"]
    if shell_type not in valid_shells:
        raise HTTPException(400, f"Invalid shell type. Must be one of: {valid_shells}")
    
    try:
        session_id = str(uuid.uuid4())
        session = await shell_session_manager.create_session(
            session_id=session_id,
            node_id=node_id.upper(),
            user_id=user.get("id", "unknown"),
            shell_type=shell_type
        )
        
        # Log audit event
        await log_audit(
            db_pool, 
            action="shell_session_start",
            user_id=user.get("id"),
            resource_type="shell_session",
            resource_id=session_id,
            details={"node_id": node_id, "shell_type": shell_type}
        )
        
        return {
            "session_id": session_id,
            "state": session.state.value,
            "shell_type": shell_type,
            "node_id": node_id.upper()
        }
    except Exception as e:
        logger.error(f"Failed to create shell session: {e}")
        raise HTTPException(500, str(e))


@router.post("/api/v1/shell/stop/{session_id}")
async def stop_shell_session(
    session_id: str,
    user: dict = Depends(get_current_user)
):
    """Stop a shell session."""
    session = shell_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    await shell_session_manager.close_session(session_id, "user_stopped")
    
    return {"status": "stopped"}


@router.get("/api/v1/shell/pending/{node_id}")
async def get_pending_shell_session(
    node_id: str,
):
    """
    Agent polls this to check for pending shell sessions.
    """
    session = shell_session_manager.get_pending_for_node(node_id.upper())
    if not session:
        return {"session": None}
    
    return {
        "session": {
            "session_id": session.session_id,
            "shell_type": session.shell_type,
            "user_id": session.user_id
        }
    }


@router.websocket("/api/v1/shell/ws/{session_id}")
async def shell_viewer_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for browser viewers to interact with remote shell.
    
    Protocol:
    - Client sends: {"type": "input", "data": "ls -la\n"}
    - Server sends: {"type": "output", "data": "..."}
    - Server sends: {"type": "info", "state": "active"}
    - Server sends: {"type": "closed", "reason": "..."}
    """
    # Auth check before accept
    user_payload = await _validate_ws_token(websocket)
    if user_payload is None:
        return

    await websocket.accept()
    logger.info(f"Shell viewer WebSocket connected for session {session_id}")
    
    session = shell_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Shell viewer tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    session.viewer_ws = websocket
    logger.info(f"Shell viewer connected to session {session_id}, state={session.state}")
    
    try:
        # Send initial info
        await websocket.send_json({
            "type": "info",
            "session_id": session_id,
            "node_id": session.node_id,
            "state": session.state.value,
            "shell_type": session.shell_type
        })
        
        # Forward input from viewer to agent
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120)
                
                if data.get("type") == "input":
                    # Forward to agent
                    if session.agent_ws:
                        await session.agent_ws.send_json(data)
                        shell_session_manager.record_command(session_id)
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Agent not connected"
                        })
                        
                elif data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    
                elif data.get("type") == "resize":
                    # Forward terminal resize to agent
                    if session.agent_ws:
                        await session.agent_ws.send_json(data)
                        
            except asyncio.TimeoutError:
                # Send keep-alive
                try:
                    await websocket.send_json({"type": "ping"})
                except:
                    break
                
    except WebSocketDisconnect:
        logger.info(f"Shell viewer disconnected from session {session_id}")
    except Exception as e:
        logger.error(f"Shell viewer WebSocket error for {session_id}: {e}")
    finally:
        logger.info(f"Shell viewer WebSocket cleanup for session {session_id}")
        session.viewer_ws = None


@router.websocket("/api/v1/shell/ws/agent/{session_id}")
async def shell_agent_websocket(websocket: WebSocket, session_id: str, api_key: str = None):
    """
    WebSocket endpoint for agents to connect shell sessions.
    
    Protocol:
    - Agent sends: {"type": "output", "data": "..."}
    - Agent sends: {"type": "ready"}
    - Agent sends: {"type": "exit", "code": 0}
    - Server sends: {"type": "input", "data": "..."}
    - Server sends: {"type": "resize", "cols": 80, "rows": 24}
    - Server sends: {"type": "stop"}
    """
    logger.info(f"Shell agent WebSocket connecting for session {session_id}")
    
    if api_key != API_KEY:
        logger.warning(f"Shell agent WebSocket rejected: invalid API key for session {session_id}")
        await websocket.close(code=4001, reason="Invalid API key")
        return
    
    await websocket.accept()
    logger.info(f"Shell agent WebSocket accepted for session {session_id}")
    
    session = shell_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Shell agent tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    if session.state != ShellSessionState.PENDING:
        logger.warning(f"Shell agent tried to connect to session {session_id} but state is {session.state}")
        await websocket.send_json({"type": "error", "message": f"Session not pending (is {session.state})"})
        await websocket.close()
        return
    
    session.agent_ws = websocket
    await shell_session_manager.activate_session(session_id)
    
    # Send config to agent
    await websocket.send_json({
        "type": "config",
        "shell_type": session.shell_type,
        "session_id": session_id
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "output":
                # Forward output to viewer
                if session.viewer_ws:
                    try:
                        await session.viewer_ws.send_json(data)
                    except:
                        pass
                        
            elif data.get("type") == "ready":
                logger.info(f"Shell agent ready for session {session_id}")
                if session.viewer_ws:
                    await session.viewer_ws.send_json({
                        "type": "info",
                        "state": "active",
                        "message": "Shell started"
                    })
                    
            elif data.get("type") == "exit":
                logger.info(f"Shell exited for session {session_id} with code {data.get('code')}")
                if session.viewer_ws:
                    await session.viewer_ws.send_json({
                        "type": "exit",
                        "code": data.get("code", 0)
                    })
                break
                    
    except WebSocketDisconnect:
        logger.info(f"Shell agent disconnected from session {session_id}")
    except Exception as e:
        logger.error(f"Shell agent WebSocket error: {e}")
    finally:
        session.agent_ws = None
        await shell_session_manager.close_session(session_id, "agent_disconnected")
        
        if session.viewer_ws:
            try:
                await session.viewer_ws.send_json({
                    "type": "closed",
                    "reason": "Agent disconnected"
                })
            except:
                pass


@router.post("/api/v1/terminal/start/{node_id}")
async def start_terminal_session(node_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Start a new terminal session for a node."""
    data = await request.json() if request.headers.get('content-type') == 'application/json' else {}
    shell = data.get('shell', 'powershell')  # powershell, cmd, bash
    
    session_id = str(uuid.uuid4())
    session = TerminalSession(session_id, node_id, shell)
    _terminal_sessions[session_id] = session
    
    return {
        "sessionId": session_id,
        "nodeId": node_id,
        "shell": shell,
        "status": "created"
    }


@router.get("/api/v1/terminal/sessions")
async def list_terminal_sessions(_: str = Depends(verify_api_key)):
    """List active terminal sessions."""
    return [
        {
            "sessionId": s.session_id,
            "nodeId": s.node_id,
            "shell": s.shell,
            "createdAt": s.created_at.isoformat(),
            "connected": s.connected
        }
        for s in _terminal_sessions.values()
    ]


@router.delete("/api/v1/terminal/session/{session_id}")
async def stop_terminal_session(session_id: str, _: str = Depends(verify_api_key)):
    """Stop a terminal session."""
    if session_id in _terminal_sessions:
        del _terminal_sessions[session_id]
    return {"status": "stopped"}


@router.post("/api/v1/terminal/session/{session_id}/input")
async def send_terminal_input(session_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Send input to a terminal session."""
    if session_id not in _terminal_sessions:
        raise HTTPException(404, "Session not found")
    
    data = await request.json()
    command = data.get('command', '')
    
    session = _terminal_sessions[session_id]
    session.pending_commands.append(command)
    
    return {"status": "queued", "command": command}


@router.get("/api/v1/terminal/session/{session_id}/output")
async def get_terminal_output(session_id: str, _: str = Depends(verify_api_key)):
    """Get output from a terminal session."""
    if session_id not in _terminal_sessions:
        raise HTTPException(404, "Session not found")
    
    session = _terminal_sessions[session_id]
    output = session.output_buffer.copy()
    session.output_buffer.clear()
    
    return {"output": output}


@router.get("/api/v1/terminal/pending/{node_id}")
async def get_pending_terminal_commands(node_id: str):
    """Agent polls this to get pending commands."""
    commands = []
    for session in _terminal_sessions.values():
        if session.node_id == node_id and session.pending_commands:
            commands.append({
                "sessionId": session.session_id,
                "shell": session.shell,
                "commands": session.pending_commands.copy()
            })
            session.pending_commands.clear()
    return {"commands": commands}


@router.post("/api/v1/terminal/output/{session_id}")
async def post_terminal_output(session_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Agent posts command output here."""
    if session_id not in _terminal_sessions:
        raise HTTPException(404, "Session not found")
    
    data = await request.json()
    output = data.get('output', '')
    
    session = _terminal_sessions[session_id]
    session.output_buffer.append(output)
    session.connected = True
    
    return {"status": "received"}


@router.websocket("/api/v1/terminal/ws/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str):
    """WebSocket for real-time terminal communication."""
    # Auth check before accept
    user_payload = await _validate_ws_token(websocket)
    if user_payload is None:
        return

    await websocket.accept()
    
    if session_id not in _terminal_sessions:
        await websocket.close(code=4004)
        return
    
    session = _terminal_sessions[session_id]
    session.connected = True
    
    try:
        while True:
            # Send any pending output
            if session.output_buffer:
                for output in session.output_buffer:
                    await websocket.send_json({"type": "output", "data": output})
                session.output_buffer.clear()
            
            # Check for input from browser
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
                if data.get("type") == "input":
                    session.pending_commands.append(data.get("data", ""))
            except asyncio.TimeoutError:
                pass
            
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        session.connected = False
