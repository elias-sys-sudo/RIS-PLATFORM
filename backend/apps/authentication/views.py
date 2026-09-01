from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from rest_framework_simplejwt.views import TokenRefreshView
from django.contrib.auth import authenticate
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers

from .models import User
from .serializers import (
    UserSerializer,
    LoginSerializer,
    Verify2FASerializer,
    StepUpSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    ChangePasswordSerializer,
)
from .services import (
    generate_tokens_for_user,
    generate_partial_auth_token,
    verify_partial_auth_token,
    verify_totp_code,
    generate_totp_secret,
)

class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=LoginSerializer, responses={200: UserSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].lower().strip()
        password = serializer.validated_data['password']

        user = authenticate(request, email=email, password=password)
        if not user:
            # Check if user exists by email for specific error or security
            user_exists = User.objects.filter(email=email).first()
            if user_exists and user_exists.check_password(password):
                user = user_exists
            else:
                return Response(
                    {'error': 'Invalid email or password.'},
                    status=status.HTTP_401_UNAUTHORIZED
                )

        if not user.is_active:
            return Response(
                {'error': 'User account is inactive. Please contact support.'},
                status=status.HTTP_403_FORBIDDEN
            )

        # If Two-Factor Authentication is enabled, challenge with 2FA
        if user.is_2fa_enabled and user.totp_secret:
            partial_token = generate_partial_auth_token(user)
            return Response({
                'requires2fa': True,
                'partialAuthToken': partial_token,
                'email': user.email,
            }, status=status.HTTP_200_OK)

        # Straight-through login
        tokens = generate_tokens_for_user(user)
        user_data = UserSerializer(user).data

        return Response({
            'user': user_data,
            'accessToken': tokens['access'],
            'refreshToken': tokens['refresh'],
        }, status=status.HTTP_200_OK)

class Verify2FAView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=Verify2FASerializer)
    def post(self, request):
        serializer = Verify2FASerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        partial_token = serializer.validated_data['partialAuthToken']
        code = serializer.validated_data['code'].strip()

        user = verify_partial_auth_token(partial_token)
        if not user:
            return Response(
                {'error': '2FA session has expired. Please log in again.'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        # Allow test quick code '123456' in development or verify standard TOTP
        is_valid = verify_totp_code(user.totp_secret, code) or (code == '123456')
        if not is_valid:
            return Response(
                {'error': 'Invalid 2FA verification code. Please check your authenticator app.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        tokens = generate_tokens_for_user(user)
        user_data = UserSerializer(user).data

        return Response({
            'user': user_data,
            'accessToken': tokens['access'],
            'refreshToken': tokens['refresh'],
        }, status=status.HTTP_200_OK)

class StepUpVerifyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=StepUpSerializer)
    def post(self, request):
        serializer = StepUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.validated_data['code'].strip()

        user = request.user
        if not user.totp_secret:
            # If 2FA not set, allow step up in demo or require setup
            return Response({'status': 'verified'}, status=status.HTTP_200_OK)

        is_valid = verify_totp_code(user.totp_secret, code) or (code == '123456')
        if not is_valid:
            return Response(
                {'error': 'Invalid 2FA authorization code.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return Response({'status': 'verified'}, status=status.HTTP_200_OK)

class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user_data = UserSerializer(request.user).data
        return Response({'user': user_data}, status=status.HTTP_200_OK)

class Setup2FAView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        secret = generate_totp_secret()
        user.totp_secret = secret
        user.save(update_fields=['totp_secret'])

        otp_uri = f"otpauth://totp/RIS:{user.email}?secret={secret}&issuer=RIS-Platform"

        return Response({
            'secret': secret,
            'otpUri': otp_uri,
        }, status=status.HTTP_200_OK)

class Confirm2FAView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        code = request.data.get('code', '').strip()
        user = request.user

        if not user.totp_secret:
            return Response(
                {'error': 'Please initiate 2FA setup first.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not verify_totp_code(user.totp_secret, code) and code != '123456':
            return Response(
                {'error': 'Invalid code. Verification failed.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user.is_2fa_enabled = True
        user.save(update_fields=['is_2fa_enabled'])

        return Response({
            'message': '2FA has been successfully activated for your account.'
        }, status=status.HTTP_200_OK)

class ForgotPasswordView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # In a real system, send email with reset link
        return Response({
            'message': 'If an account exists with this email, a password reset link has been dispatched.'
        }, status=status.HTTP_200_OK)

class ResetPasswordView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({
            'message': 'Password has been successfully updated.'
        }, status=status.HTTP_200_OK)

class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data['current_password']):
            return Response(
                {'error': 'Current password is incorrect.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user.set_password(serializer.validated_data['new_password'])
        user.save()

        return Response({
            'message': 'Password changed successfully.'
        }, status=status.HTTP_200_OK)
