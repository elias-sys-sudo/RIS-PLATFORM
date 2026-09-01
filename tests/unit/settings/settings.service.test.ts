process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

// ---------------------------------------------------------------------------
// Mocks — must be before imports
// ---------------------------------------------------------------------------
jest.mock('../../../src/services/settings/settings.repository');
jest.mock('../../../src/shared/crypto', () => ({
  encrypt: jest.fn((v: string) => `enc_${v}`),
  decrypt: jest.fn((v: string) => v.replace('enc_', '')),
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));
jest.mock('../../../src/shared/database/pool', () => ({
  pool: { connect: jest.fn() },
  query: jest.fn(),
  beginWithRls: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import * as settingsService from '../../../src/services/settings/settings.service';
import * as settingsRepo from '../../../src/services/settings/settings.repository';
import { decrypt } from '../../../src/shared/crypto';
import { logger } from '../../../src/shared/logger';
import { NotFoundError } from '../../../src/shared/errors';
import type {
  UserProfileRow,
  UserSettingsRow,
  UserPiiRow,
  SupplierPiiRow,
} from '../../../src/services/settings/settings.types';

const mockedRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;
const mockedDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

// ---------------------------------------------------------------------------
// Fixtures — no real PII
// ---------------------------------------------------------------------------
function buildUserProfileRow(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: 'user-1',
    email: 'test@example.com',
    first_name_encrypted: 'enc_FName',
    last_name_encrypted: 'enc_LName',
    phone_encrypted: 'enc_+256700000000',
    ...overrides,
  };
}

function buildUserSettingsRow(overrides: Partial<UserSettingsRow> = {}): UserSettingsRow {
  return {
    id: 'settings-1',
    user_id: 'user-1',
    email_notifications: true,
    sms_notifications: false,
    in_app_notifications: true,
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-02'),
    ...overrides,
  };
}

function buildUserPiiRow(overrides: Partial<UserPiiRow> = {}): UserPiiRow {
  return {
    id: 'user-1',
    email: 'test@example.com',
    first_name_encrypted: 'enc_FName',
    last_name_encrypted: 'enc_LName',
    phone_encrypted: 'enc_+256700000000',
    role: 'supplier',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildSupplierPiiRow(overrides: Partial<SupplierPiiRow> = {}): SupplierPiiRow {
  return {
    id: 'supplier-1',
    company_name_encrypted: 'enc_TestCo',
    registration_number: 'REG-001',
    bank_account_number_encrypted: 'enc_9876543210',
    bank_account_name_encrypted: 'enc_TestCoAccount',
    mobile_money_number_encrypted: 'enc_+256711111111',
    kyc_status: 'approved',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getProfile
  // =========================================================================
  describe('getProfile', () => {
    it('returns decrypted profile for a valid user', async () => {
      const row = buildUserProfileRow();
      mockedRepo.fetchProfile.mockResolvedValue(row);

      const result = await settingsService.getProfile('user-1');

      expect(result).toEqual({
        id: 'user-1',
        name: 'FName LName',
        email: 'test@example.com',
        phone: '+256700000000',
      });
      expect(mockedRepo.fetchProfile).toHaveBeenCalledWith('user-1');
    });

    it('calls decrypt for each encrypted field', async () => {
      const row = buildUserProfileRow();
      mockedRepo.fetchProfile.mockResolvedValue(row);

      await settingsService.getProfile('user-1');

      expect(mockedDecrypt).toHaveBeenCalledWith('enc_FName');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_LName');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_+256700000000');
    });

    it('throws NotFoundError when user does not exist', async () => {
      mockedRepo.fetchProfile.mockResolvedValue(null);

      await expect(settingsService.getProfile('missing-user')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('handles null first_name_encrypted gracefully', async () => {
      const row = buildUserProfileRow({
        first_name_encrypted: null,
        last_name_encrypted: null,
      });
      mockedRepo.fetchProfile.mockResolvedValue(row);

      const result = await settingsService.getProfile('user-1');

      // Falls back to email prefix when names are null
      expect(result.name).toBe('test');
      expect(result.phone).toBe('+256700000000');
    });

    it('handles null phone_encrypted gracefully', async () => {
      const row = buildUserProfileRow({ phone_encrypted: null });
      mockedRepo.fetchProfile.mockResolvedValue(row);

      const result = await settingsService.getProfile('user-1');

      expect(result.phone).toBe('');
    });

    it('handles null last_name_encrypted with valid first name', async () => {
      const row = buildUserProfileRow({ last_name_encrypted: null });
      mockedRepo.fetchProfile.mockResolvedValue(row);

      const result = await settingsService.getProfile('user-1');

      expect(result.name).toBe('FName');
    });
  });

  // =========================================================================
  // updateProfile
  // =========================================================================
  describe('updateProfile', () => {
    it('calls repo.updateProfile and createAuditEntry, returns updated profile', async () => {
      const updatedRow = buildUserProfileRow();
      mockedRepo.updateProfile.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);
      mockedRepo.fetchProfile.mockResolvedValue(updatedRow);

      const result = await settingsService.updateProfile(
        'user-1',
        { name: 'NewFirst NewLast' },
        '127.0.0.1',
        'TestAgent/1.0',
      );

      expect(mockedRepo.updateProfile).toHaveBeenCalledWith('user-1', { name: 'NewFirst NewLast' });
      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'PROFILE_UPDATED',
        '127.0.0.1',
        'TestAgent/1.0',
        { fieldsUpdated: ['name'] },
      );
      expect(result.id).toBe('user-1');
    });

    it('logs audit event after update', async () => {
      mockedRepo.updateProfile.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);
      mockedRepo.fetchProfile.mockResolvedValue(buildUserProfileRow());

      await settingsService.updateProfile('user-1', { email: 'new@test.com' }, '10.0.0.1', 'UA');

      expect(mockedLogger.audit).toHaveBeenCalledWith(
        'PROFILE_UPDATED',
        expect.objectContaining({
          component: 'settings',
          userId: 'user-1',
          fieldsUpdated: ['email'],
        }),
      );
    });

    it('includes all updated field names in audit metadata', async () => {
      mockedRepo.updateProfile.mockResolvedValue(undefined);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);
      mockedRepo.fetchProfile.mockResolvedValue(buildUserProfileRow());

      await settingsService.updateProfile(
        'user-1',
        { name: 'X Y', phone: '+256700000001' },
        '10.0.0.1',
        'UA',
      );

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'PROFILE_UPDATED',
        '10.0.0.1',
        'UA',
        { fieldsUpdated: ['name', 'phone'] },
      );
    });
  });

  // =========================================================================
  // getNotificationPreferences
  // =========================================================================
  describe('getNotificationPreferences', () => {
    it('returns stored preferences when a row exists', async () => {
      const row = buildUserSettingsRow({
        email_notifications: false,
        sms_notifications: true,
        in_app_notifications: false,
      });
      mockedRepo.getUserSettings.mockResolvedValue(row);

      const result = await settingsService.getNotificationPreferences('user-1');

      expect(result).toEqual({
        email_notifications: false,
        sms_notifications: true,
        in_app_notifications: false,
      });
    });

    it('returns defaults when no settings row exists', async () => {
      mockedRepo.getUserSettings.mockResolvedValue(null);

      const result = await settingsService.getNotificationPreferences('user-1');

      expect(result).toEqual({
        email_notifications: true,
        sms_notifications: true,
        in_app_notifications: true,
      });
    });

    it('returns a new object each time defaults are used (no shared reference)', async () => {
      mockedRepo.getUserSettings.mockResolvedValue(null);

      const result1 = await settingsService.getNotificationPreferences('user-1');
      const result2 = await settingsService.getNotificationPreferences('user-1');

      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });
  });

  // =========================================================================
  // updateNotificationPreferences
  // =========================================================================
  describe('updateNotificationPreferences', () => {
    it('calls upsertUserSettings and returns new values', async () => {
      const upsertedRow = buildUserSettingsRow({
        email_notifications: false,
        sms_notifications: true,
        in_app_notifications: true,
      });
      mockedRepo.upsertUserSettings.mockResolvedValue(upsertedRow);

      const input = {
        emailNotifications: false,
        smsNotifications: true,
        inAppNotifications: true,
      };

      const result = await settingsService.updateNotificationPreferences('user-1', input);

      expect(mockedRepo.upsertUserSettings).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual({
        email_notifications: false,
        sms_notifications: true,
        in_app_notifications: true,
      });
    });

    it('logs audit event for notification preferences update', async () => {
      mockedRepo.upsertUserSettings.mockResolvedValue(buildUserSettingsRow());

      await settingsService.updateNotificationPreferences('user-1', {
        emailNotifications: true,
        smsNotifications: true,
        inAppNotifications: true,
      });

      expect(mockedLogger.audit).toHaveBeenCalledWith(
        'NOTIFICATION_PREFERENCES_UPDATED',
        expect.objectContaining({ component: 'settings', userId: 'user-1' }),
      );
    });
  });

  // =========================================================================
  // getMyData
  // =========================================================================
  describe('getMyData', () => {
    it('returns full personal data export with supplier data', async () => {
      const userRow = buildUserPiiRow();
      const supplierRow = buildSupplierPiiRow();
      mockedRepo.fetchUserPii.mockResolvedValue(userRow);
      mockedRepo.fetchSupplierPii.mockResolvedValue(supplierRow);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await settingsService.getMyData('user-1', '127.0.0.1', 'TestAgent');

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        name: 'FName LName',
        phone: '+256700000000',
        role: 'supplier',
        created_at: '2025-01-01T00:00:00Z',
      });
      expect(result.supplier).toEqual({
        id: 'supplier-1',
        company_name: 'TestCo',
        registration_number: 'REG-001',
        bank_account_number: '9876543210',
        bank_account_name: 'TestCoAccount',
        mobile_money_number: '+256711111111',
        kyc_status: 'approved',
      });
      expect(result.exported_at).toBeDefined();
    });

    it('calls decrypt for all encrypted user and supplier fields', async () => {
      mockedRepo.fetchUserPii.mockResolvedValue(buildUserPiiRow());
      mockedRepo.fetchSupplierPii.mockResolvedValue(buildSupplierPiiRow());
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await settingsService.getMyData('user-1', '127.0.0.1', 'UA');

      // User PII decryption
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_FName');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_LName');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_+256700000000');
      // Supplier PII decryption
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_TestCo');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_9876543210');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_TestCoAccount');
      expect(mockedDecrypt).toHaveBeenCalledWith('enc_+256711111111');
    });

    it('logs audit entry as DATA_SUBJECT_ACCESS_REQUEST', async () => {
      mockedRepo.fetchUserPii.mockResolvedValue(buildUserPiiRow());
      mockedRepo.fetchSupplierPii.mockResolvedValue(buildSupplierPiiRow());
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await settingsService.getMyData('user-1', '10.0.0.1', 'UA/2.0');

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'DATA_SUBJECT_ACCESS_REQUEST',
        '10.0.0.1',
        'UA/2.0',
        { hasSupplierData: true },
      );
      expect(mockedLogger.audit).toHaveBeenCalledWith(
        'DATA_SUBJECT_ACCESS_REQUEST',
        expect.objectContaining({ component: 'settings', userId: 'user-1' }),
      );
    });

    it('returns null supplier when user has no supplier record', async () => {
      mockedRepo.fetchUserPii.mockResolvedValue(buildUserPiiRow());
      mockedRepo.fetchSupplierPii.mockResolvedValue(null);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await settingsService.getMyData('user-1', '127.0.0.1', 'UA');

      expect(result.supplier).toBeNull();
    });

    it('sets hasSupplierData=false in audit when supplier is null', async () => {
      mockedRepo.fetchUserPii.mockResolvedValue(buildUserPiiRow());
      mockedRepo.fetchSupplierPii.mockResolvedValue(null);
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      await settingsService.getMyData('user-1', '127.0.0.1', 'UA');

      expect(mockedRepo.createAuditEntry).toHaveBeenCalledWith(
        'user-1',
        'DATA_SUBJECT_ACCESS_REQUEST',
        '127.0.0.1',
        'UA',
        { hasSupplierData: false },
      );
    });

    it('throws NotFoundError when user does not exist', async () => {
      mockedRepo.fetchUserPii.mockResolvedValue(null);

      await expect(
        settingsService.getMyData('missing-user', '127.0.0.1', 'UA'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('handles null encrypted supplier fields gracefully', async () => {
      mockedRepo.fetchUserPii.mockResolvedValue(buildUserPiiRow());
      mockedRepo.fetchSupplierPii.mockResolvedValue(
        buildSupplierPiiRow({
          company_name_encrypted: null,
          bank_account_number_encrypted: null,
          bank_account_name_encrypted: null,
          mobile_money_number_encrypted: null,
        }),
      );
      mockedRepo.createAuditEntry.mockResolvedValue(undefined);

      const result = await settingsService.getMyData('user-1', '127.0.0.1', 'UA');

      expect(result.supplier).not.toBeNull();
      expect(result.supplier!.company_name).toBe('');
      expect(result.supplier!.bank_account_number).toBe('');
      expect(result.supplier!.bank_account_name).toBe('');
      expect(result.supplier!.mobile_money_number).toBe('');
    });
  });
});
