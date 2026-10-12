"""Hermes native plugin marker.

The functionality lives in the separately discovered dashboard extension.
No LLM tools, hooks, or permissions are registered by this plugin.
"""


def register(ctx):
    """Let Hermes validate and activate the dashboard-only plugin package."""
    return None
