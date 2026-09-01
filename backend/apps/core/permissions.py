from rest_framework.permissions import BasePermission

class HasRole(BasePermission):
    """
    Permission class checking if the user has any of the allowed roles.
    Usage: permission_classes = [HasRole.with_roles('supplier', 'finance_manager')]
    """
    allowed_roles = ()

    @classmethod
    def with_roles(cls, *roles):
        return type(
            f"HasRole_{'_'.join(roles)}",
            (cls,),
            {'allowed_roles': roles}
        )

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        return getattr(request.user, 'role', None) in self.allowed_roles

class IsSupplier(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'supplier')

class IsCreditOfficer(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'credit_officer')

class IsFinanceManager(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'finance_manager')

class IsManagement(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'management')
