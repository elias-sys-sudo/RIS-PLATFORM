from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status

def custom_exception_handler(exc, context):
    """
    Standardized REST API Exception Handler providing consistent error JSON structures.
    """
    response = exception_handler(exc, context)

    if response is not None:
        error_message = 'An error occurred processing the request.'
        
        if isinstance(response.data, dict):
            if 'detail' in response.data:
                error_message = str(response.data['detail'])
            elif 'message' in response.data:
                error_message = str(response.data['message'])
            elif 'error' in response.data:
                error_message = str(response.data['error'])
            else:
                first_key = next(iter(response.data))
                first_val = response.data[first_key]
                if isinstance(first_val, list) and first_val:
                    error_message = f"{first_key}: {first_val[0]}"
                else:
                    error_message = f"{first_key}: {first_val}"
        elif isinstance(response.data, list) and response.data:
            error_message = str(response.data[0])

        response.data = {
            'error': error_message,
            'message': error_message,
            'status': response.status_code,
            'details': response.data if isinstance(response.data, dict) else {},
        }

    return response
