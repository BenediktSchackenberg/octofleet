# AI Fix #43
Improve API error messages to provide clear and consistent error responses
```diff
--- a/backend/main.py
+++ b/backend/main.py
@@ -10,6 +10,7 @@
 from fastapi import FastAPI, HTTPException
 from fastapi.responses import JSONResponse
 from pydantic import BaseModel

+from enum import Enum

 app = FastAPI()

 class ErrorCode(Enum):
@@ -20,7 +21,7 @@
     def get(self):
         try:
             # Simulating an error
-            raise Exception("Internal Server Error")
+            raise HTTPException(status_code=500, detail="Failed to process request. Please check your input.")

         except Exception as e:
-            return JSONResponse(status_code=500, content={"error": "Internal Server Error"})
+            return JSONResponse(status_code=500, content={"error_code": ErrorCode.SERVER_ERROR, "error": str(e)})

 # Example endpoint
```
Closes #43