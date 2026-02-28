import re
import json

def evaluate_dynamic_rule(rule: dict, node_data: dict) -> bool:
    """
    Evaluate a dynamic group rule against node data.
    
    Rule format:
    {
        "operator": "AND" | "OR",
        "conditions": [
            { "field": "os_name", "op": "equals|contains|startswith|endswith|gte|lte|gt|lt", "value": "..." },
            ...
        ]
    }
    
    Supported fields:
    - os_name, os_version, os_build, hostname, agent_version
    - tags (special: checks if node has tag)
    - cpu_name, total_memory_gb (from hardware)
    """
    if not rule or not isinstance(rule, dict):
        return False
    
    operator = rule.get("operator", "AND").upper()
    conditions = rule.get("conditions", [])
    
    if not conditions:
        return False
    
    results = []
    for cond in conditions:
        field = cond.get("field", "")
        op = cond.get("op", "equals")
        value = cond.get("value", "")
        
        # Get node field value
        node_value = node_data.get(field)
        if node_value is None:
            node_value = ""
        
        # Convert to string for comparison
        node_value_str = str(node_value).lower()
        value_str = str(value).lower()
        
        # Evaluate condition
        match = False
        try:
            if op == "equals":
                match = node_value_str == value_str
            elif op == "contains":
                match = value_str in node_value_str
            elif op == "startswith":
                match = node_value_str.startswith(value_str)
            elif op == "endswith":
                match = node_value_str.endswith(value_str)
            elif op == "gte":
                match = float(node_value) >= float(value)
            elif op == "lte":
                match = float(node_value) <= float(value)
            elif op == "gt":
                match = float(node_value) > float(value)
            elif op == "lt":
                match = float(node_value) < float(value)
            elif op == "regex":
                match = bool(re.search(value, str(node_value), re.IGNORECASE))
            elif op == "not_equals":
                match = node_value_str != value_str
            elif op == "not_contains":
                match = value_str not in node_value_str
            elif op == "has_tag":
                # Special: check if node has specific tag
                tags = node_data.get("tags", [])
                match = value_str in [t.lower() for t in tags]
        except (ValueError, TypeError):
            match = False
        
        results.append(match)
    
    # Combine results
    if operator == "AND":
        return all(results)
    else:  # OR
        return any(results)
