# AI Fix #40
Add loading skeletons to dashboard cards
```diff
--- a/frontend/src/app/page.tsx
+++ b/frontend/src/app/page.tsx
@@ -10,6 +10,7 @@
 import { useState, useEffect } from 'react';
 import DashboardCard from './DashboardCard';
 
+import Skeleton from './Skeleton';
 
 const Page = () => {
   const [data, setData] = useState(null);
@@ -25,7 +26,7 @@
       {data ? (
         <DashboardCard data={data} />
       ) : (
-        <div className="flex justify-center">
-          <svg className="animate-spin h-5 w-5 mr-3 border-4 border-gray-200 rounded-full border-t-gray-600" viewBox="0 0 24 24"></svg>
-        </div>
+        <Skeleton />
       )}
     </div>
   );
 };
```
Closes #40