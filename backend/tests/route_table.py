"""The app's API routes in the order FastAPI matches them, including the routes of included routers.

Newer FastAPI versions keep an included router as one entry in app.routes; its routes only show
up through iter_route_contexts. Older versions copy them into app.routes. Each entry has path,
methods, endpoint and dependant (with the dependencies added when the router was included).
"""
import re

from fastapi.routing import APIRoute

try:
    from fastapi.routing import iter_route_contexts
except ImportError:  # older FastAPI: the routes of included routers are in app.routes
    iter_route_contexts = None


def api_routes(app):
    if iter_route_contexts is None:
        return [route for route in app.routes if isinstance(route, APIRoute)]
    return [context for context in iter_route_contexts(app.routes)
            if isinstance(context.original_route, APIRoute)]


def route_key(method, path):
    """/nodes/{node_id} and /nodes/{id} match the same requests."""
    return method, re.sub(r"\{[^}]*\}", "{}", path)
