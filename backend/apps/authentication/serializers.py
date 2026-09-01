from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User

class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='full_name', read_only=True)
    twoFactorEnabled = serializers.BooleanField(source='is_2fa_enabled', read_only=True)
    kycStatus = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'email',
            'name',
            'first_name',
            'last_name',
            'role',
            'kycStatus',
            'twoFactorEnabled',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'twoFactorEnabled']

    def get_kycStatus(self, obj):
        # Return supplier KYC status if available, else 'approved' for staff
        if obj.role == 'supplier':
            return 'approved' # Will link to supplier KYC state in Phase B3
        return 'approved'

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

class Verify2FASerializer(serializers.Serializer):
    code = serializers.CharField(max_length=8)
    partialAuthToken = serializers.CharField()

class StepUpSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=8)

class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=8)

class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField(min_length=8)
    confirm_password = serializers.CharField(min_length=8)

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError({"confirm_password": "New passwords must match."})
        return data
