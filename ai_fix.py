# AI Fix #41
Add copy-to-clipboard button for node ID
```diff
diff --git a/frontend/src/app/nodes/[nodeId]/page.tsx b/frontend/src/app/nodes/[nodeId]/page.tsx
--- a/frontend/src/app/nodes/[nodeId]/page.tsx
+++ b/frontend/src/app/nodes/[nodeId]/page.tsx
@@ -10,6 +10,7 @@
 import { useState } from 'react';
 import { Node } from '../../types';
 import { Toast } from '../../components/Toast';

+import { FaClipboard } from 'react-icons/fa';

 const NodePage = () => {
   const [node, setNode] = useState<Node | null>(null);
@@ -25,6 +26,11 @@
   return (
     <div>
       <h2>Node {node?.id}</h2>
+      <button
+        className="copy-button"
+        onClick={() => {
+          navigator.clipboard.writeText(node?.id || '').then(() => Toast('Copied!'));
+        }}
+      >
+        <FaClipboard size={16} />
+      </button>
     </div>
   );
 };

 export default NodePage;
```