
import sys

print(f"Python version: {sys.version}")

try:
    import google.genai
    print("\n--- google.genai ---")
    print(f"Version: {getattr(google.genai, '__version__', 'unknown')}")
    
    if hasattr(google.genai, 'types'):
        print(f"google.genai.types has BlockedPromptException: {'BlockedPromptException' in dir(google.genai.types)}")
    else:
        print("google.genai.types not found")
        
    if hasattr(google.genai, 'errors'):
        print(f"google.genai.errors has BlockedPromptException: {'BlockedPromptException' in dir(google.genai.errors)}")
        # List all errors to see what we have
        print(f"Errors available: {[e for e in dir(google.genai.errors) if 'Exception' in e or 'Error' in e]}")
    else:
        print("google.genai.errors not found")

except ImportError:
    print("\ngoogle.genai not installed")

try:
    import google.generativeai
    print("\n--- google.generativeai ---")
    print(f"Version: {getattr(google.generativeai, '__version__', 'unknown')}")
    
    if hasattr(google.generativeai, 'types'):
         print(f"google.generativeai.types has BlockedPromptException: {'BlockedPromptException' in dir(google.generativeai.types)}")
    else:
        print("google.generativeai.types not found")

except ImportError:
    print("\ngoogle.generativeai not installed")

try:
    from google.api_core import exceptions
    print("\n--- google.api_core.exceptions ---")
    print(f"BlockedPromptException available: {'BlockedPromptException' in dir(exceptions)}")
except ImportError:
    print("\ngoogle.api_core not installed")
