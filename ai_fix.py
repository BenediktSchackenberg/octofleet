# AI Fix #42
Improve API error messages
```diff
--- a/backend/main.py
+++ b/backend/main.py
@@ -10,6 +10,7 @@
 from fastapi import FastAPI, HTTPException
 from pydantic import BaseModel

+from enum import Enum

 app = FastAPI()

@@ -20,12 +21,20 @@
 class ErrorResponse(BaseModel):
     error_code: int
     error_message: str

+class ErrorCode(Enum):
+    INTERNAL_SERVER_ERROR = 500
+    INVALID_REQUEST = 400

 @app.get("/items/")
 async def read_items():
-    try:
-        # some code that may raise an exception
-        raise Exception("Something went wrong")
-    except Exception as e:
-        return {"error": "Internal Server Error"}
+    try:
+        # some code that may raise an exception
+        raise Exception("Something went wrong")
+    except Exception as e:
+        raise HTTPException(
+            status_code=ErrorCode.INTERNAL_SERVER_ERROR.value,
+            detail="An internal server error occurred",
+        )

 @app.get("/items/{item_id}")
 async def read_item(item_id: int):
-    # some code that may raise an exception
+    try:
+        # some code that may raise an exception
+        raise Exception("Invalid request")
+    except Exception as e:
+        raise HTTPException(
+            status_code=ErrorCode.INVALID_REQUEST.value,
+            detail="Invalid request parameters",
+        )
```