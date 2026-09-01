#!/usr/bin/env bash
# =============================================================================
# MMS Platform — API Endpoint Audit Script
# Tests every backend endpoint with realistic data from seed users.
# NOTE: Before running, set RATE_LIMIT_AUTH_MAX=200 in .env.local to avoid
#       hitting the auth rate limiter during bulk testing.
# =============================================================================
set +e  # Continue on errors — we capture and report them

BASE_URL="${BASE_URL:-http://localhost:4000}"
PASS=0
FAIL=0
TOTAL=0
RESULTS=""

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_result() {
  local endpoint="$1"
  local status="$2"
  local issue="${3:-—}"
  local root_cause="${4:-—}"
  TOTAL=$((TOTAL + 1))
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
    RESULTS="${RESULTS}\n| ${endpoint} | ✅ PASS | ${issue} | ${root_cause} |"
    echo -e "${GREEN}✅ PASS${NC} ${endpoint}"
  else
    FAIL=$((FAIL + 1))
    RESULTS="${RESULTS}\n| ${endpoint} | ❌ FAIL | ${issue} | ${root_cause} |"
    echo -e "${RED}❌ FAIL${NC} ${endpoint} — ${issue}"
  fi
}

# Extract JSON value by key (basic, no jq dependency)
json_val() {
  echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

test_endpoint() {
  local method="$1"
  local path="$2"
  local label="$3"
  local expected_status="${4:-200}"
  local token="${5:-}"
  local body="${6:-}"

  local curl_args=(-s -o /tmp/mms_response.json -w '%{http_code}' -X "$method")

  if [ -n "$token" ]; then
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi
  curl_args+=(-H "Content-Type: application/json")
  curl_args+=(-H "Origin: http://localhost:5173")

  if [ -n "$body" ]; then
    curl_args+=(-d "$body")
  fi

  local http_code
  http_code=$(curl "${curl_args[@]}" "${BASE_URL}${path}" 2>/dev/null || echo "000")

  local response_body
  response_body=$(cat /tmp/mms_response.json 2>/dev/null || echo "")

  if [ "$http_code" = "$expected_status" ]; then
    log_result "$label" "PASS"
  else
    local issue="Expected ${expected_status}, got ${http_code}"
    local snippet
    snippet=$(echo "$response_body" | head -c 200)
    log_result "$label" "FAIL" "$issue" "$snippet"
  fi
}

# ---------------------------------------------------------------------------
# Helper: login and extract accessToken
# ---------------------------------------------------------------------------
do_login() {
  local email="$1"
  local password="$2"
  local label="$3"

  local resp
  resp=$(curl -s -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" 2>/dev/null)

  local token
  token=$(json_val "$resp" "accessToken")

  if [ -n "$token" ]; then
    log_result "POST /auth/login (${label})" "PASS" >&2
    echo "$token"
  else
    log_result "POST /auth/login (${label})" "FAIL" "No accessToken returned" "$(echo "$resp" | head -c 120)" >&2
    echo ""
  fi
}

echo "================================================================="
echo " MMS Platform — API Endpoint Audit"
echo " Base URL: ${BASE_URL}"
echo " Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "================================================================="
echo ""

# ---------------------------------------------------------------------------
# 0. Health check
# ---------------------------------------------------------------------------
echo "--- Health ---"
test_endpoint GET /health "GET /health" 200

# ---------------------------------------------------------------------------
# 1. Auth — login as all 7 roles
# ---------------------------------------------------------------------------
echo ""
echo "--- Auth (logins) ---"

SUPPLIER_TOKEN=$(do_login "supplier1@test.ris.co.ug" "TestPassword123!" "supplier")
CREDIT_TOKEN=$(do_login "credit1@test.ris.co.ug" "TestPassword123!" "credit_officer")
FINANCE_TOKEN=$(do_login "finance1@test.ris.co.ug" "TestPassword123!" "finance_manager")
MGMT_TOKEN=$(do_login "md1@test.ris.co.ug" "TestPassword123!" "management")
COMPLIANCE_TOKEN=$(do_login "compliance1@test.ris.co.ug" "TestPassword123!" "compliance")
AUDITOR_TOKEN=$(do_login "auditor1@test.ris.co.ug" "TestPassword123!" "auditor")
LEGAL_TOKEN=$(do_login "legal1@test.ris.co.ug" "TestPassword123!" "legal")

echo ""
echo "--- Auth (misc) ---"

# Bad password
test_endpoint POST /auth/login "POST /auth/login (wrong password)" 401 "" \
  '{"email":"supplier1@test.ris.co.ug","password":"WrongPassword!"}'

# No auth → 401
test_endpoint GET /invoices "GET /invoices (no auth → 401)" 401

# Forgot password
test_endpoint POST /auth/forgot-password "POST /auth/forgot-password" 200 "" \
  '{"email":"supplier1@test.ris.co.ug"}'

# Reset password (bad token → 401 AuthError)
RESET_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X POST "${BASE_URL}/auth/reset-password" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"token":"aaaaaaaaaaaabbbbbbbbbbbbccccccccccccddddddddddddeeeeeeeeeeee1234","new_password":"NewPassword123!"}' 2>/dev/null)
if [ "$RESET_CODE" = "400" ] || [ "$RESET_CODE" = "401" ] || [ "$RESET_CODE" = "404" ]; then
  log_result "POST /auth/reset-password (bad token)" "PASS"
else
  log_result "POST /auth/reset-password (bad token)" "FAIL" "Expected 4xx, got ${RESET_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
fi

# Change password (set same password — should fail with "must differ")
CHANGE_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X PUT "${BASE_URL}/auth/change-password" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SUPPLIER_TOKEN}" \
  -H "Origin: http://localhost:5173" \
  -d '{"current_password":"TestPassword123!","new_password":"NewTestPass1!x","confirm_password":"NewTestPass1!x"}' 2>/dev/null)
if [ "$CHANGE_CODE" = "200" ]; then
  log_result "PUT /auth/change-password" "PASS"
  # Change back
  curl -s -o /dev/null -X PUT "${BASE_URL}/auth/change-password" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${SUPPLIER_TOKEN}" \
    -H "Origin: http://localhost:5173" \
    -d '{"current_password":"NewTestPass1!x","new_password":"TestPassword123!","confirm_password":"TestPassword123!"}' 2>/dev/null
  # Re-login
  SUPPLIER_TOKEN=$(do_login "supplier1@test.ris.co.ug" "TestPassword123!" "supplier-relogin")
else
  log_result "PUT /auth/change-password" "FAIL" "Got ${CHANGE_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
fi

# Logout
test_endpoint POST /auth/logout "POST /auth/logout" 200 "$SUPPLIER_TOKEN"

# Re-login supplier
SUPPLIER_TOKEN=$(do_login "supplier1@test.ris.co.ug" "TestPassword123!" "supplier-relogin")

# ---------------------------------------------------------------------------
# 2. Dashboard
# ---------------------------------------------------------------------------
echo ""
echo "--- Dashboard ---"
test_endpoint GET /dashboard/summary "GET /dashboard/summary" 200 "$MGMT_TOKEN"
test_endpoint GET "/dashboard/summary?period=7d" "GET /dashboard/summary?period=7d" 200 "$MGMT_TOKEN"
test_endpoint GET "/dashboard/summary?period=30d" "GET /dashboard/summary?period=30d" 200 "$MGMT_TOKEN"
test_endpoint GET "/dashboard/summary?period=90d" "GET /dashboard/summary?period=90d" 200 "$MGMT_TOKEN"
test_endpoint GET "/dashboard/summary?period=all" "GET /dashboard/summary?period=all" 200 "$MGMT_TOKEN"
test_endpoint GET /dashboard/payments "GET /dashboard/payments" 200 "$MGMT_TOKEN"
test_endpoint GET /dashboard/approval-queue "GET /dashboard/approval-queue" 200 "$MGMT_TOKEN"
test_endpoint GET /dashboard/funding-pipeline "GET /dashboard/funding-pipeline" 200 "$MGMT_TOKEN"
test_endpoint GET /dashboard/supplier/summary "GET /dashboard/supplier/summary" 200 "$SUPPLIER_TOKEN"
test_endpoint GET /dashboard/legal/summary "GET /dashboard/legal/summary" 200 "$LEGAL_TOKEN"
test_endpoint GET /dashboard/risk-distribution "GET /dashboard/risk-distribution" 200 "$MGMT_TOKEN"
# payments/history requires supplier_id — tested after supplier lookup below

# ---------------------------------------------------------------------------
# 3. Invoices
# ---------------------------------------------------------------------------
echo ""
echo "--- Invoices ---"

INVOICES_RESP=$(curl -s -X GET "${BASE_URL}/invoices" \
  -H "Authorization: Bearer ${CREDIT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
FIRST_INVOICE_ID=$(json_val "$INVOICES_RESP" "id")

test_endpoint GET /invoices "GET /invoices" 200 "$CREDIT_TOKEN"
test_endpoint GET "/invoices?status=overdue" "GET /invoices?status=overdue" 200 "$CREDIT_TOKEN"
test_endpoint GET "/invoices?page=1&limit=5" "GET /invoices?page=1&limit=5" 200 "$CREDIT_TOKEN"

if [ -n "$FIRST_INVOICE_ID" ]; then
  test_endpoint GET "/invoices/${FIRST_INVOICE_ID}" "GET /invoices/:id" 200 "$CREDIT_TOKEN"
  test_endpoint GET "/invoices/${FIRST_INVOICE_ID}/timeline" "GET /invoices/:id/timeline" 200 "$CREDIT_TOKEN"
else
  log_result "GET /invoices/:id" "FAIL" "No invoice ID" "Empty list"
fi

# Get supplier + buyer IDs for invoice creation
SUPPLIERS_RESP=$(curl -s -X GET "${BASE_URL}/suppliers" \
  -H "Authorization: Bearer ${CREDIT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
SUPPLIER_ID=$(json_val "$SUPPLIERS_RESP" "id")

BUYERS_RESP=$(curl -s -X GET "${BASE_URL}/buyers" \
  -H "Authorization: Bearer ${CREDIT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
BUYER_ID=$(json_val "$BUYERS_RESP" "id")

if [ -n "$SUPPLIER_ID" ] && [ -n "$BUYER_ID" ]; then
  INVOICE_NUM="INV-AUDIT-$(date +%s)"
  NEW_INVOICE_BODY="{\"invoice_number\":\"${INVOICE_NUM}\",\"buyer_id\":\"${BUYER_ID}\",\"face_value\":50000000,\"due_date\":\"2026-06-01\",\"description\":\"API audit test invoice\"}"
  test_endpoint POST /invoices/submit "POST /invoices/submit" 201 "$SUPPLIER_TOKEN" "$NEW_INVOICE_BODY"
else
  log_result "POST /invoices/submit" "FAIL" "Missing IDs" "supplier=${SUPPLIER_ID} buyer=${BUYER_ID}"
fi

# ---------------------------------------------------------------------------
# 4. Approvals
# ---------------------------------------------------------------------------
echo ""
echo "--- Approvals ---"
test_endpoint GET /invoices/queue "GET /invoices/queue" 200 "$CREDIT_TOKEN"
test_endpoint GET /approvals "GET /approvals" 200 "$CREDIT_TOKEN"
test_endpoint GET /approvals/history "GET /approvals/history" 200 "$CREDIT_TOKEN"

if [ -n "$FIRST_INVOICE_ID" ]; then
  test_endpoint GET "/approvals/${FIRST_INVOICE_ID}" "GET /approvals/:invoiceId" 200 "$CREDIT_TOKEN"
fi

# ---------------------------------------------------------------------------
# 5. Collections
# ---------------------------------------------------------------------------
echo ""
echo "--- Collections ---"
test_endpoint GET /collections "GET /collections" 200 "$CREDIT_TOKEN"
test_endpoint GET /collections/overdue "GET /collections/overdue" 200 "$CREDIT_TOKEN"

COLLECTIONS_RESP=$(curl -s -X GET "${BASE_URL}/collections" \
  -H "Authorization: Bearer ${CREDIT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
COLLECTION_ID=$(json_val "$COLLECTIONS_RESP" "id")

if [ -n "$COLLECTION_ID" ]; then
  test_endpoint GET "/collections/${COLLECTION_ID}" "GET /collections/:id" 200 "$CREDIT_TOKEN"
  test_endpoint GET "/collections/${COLLECTION_ID}/penalty" "GET /collections/:id/penalty" 200 "$CREDIT_TOKEN"

  PAYMENT_BODY="{\"amount\":1000000,\"method\":\"bank_transfer\",\"reference\":\"AUDIT-$(date +%s)\",\"paid_by\":\"Test Buyer\",\"payment_date\":\"2026-03-26T12:00:00Z\",\"notes\":\"audit test\"}"
  test_endpoint POST "/collections/${COLLECTION_ID}/payments" "POST /collections/:id/payments" 200 "$CREDIT_TOKEN" "$PAYMENT_BODY"

  test_endpoint POST "/collections/${COLLECTION_ID}/escalate" "POST /collections/:id/escalate" 200 "$CREDIT_TOKEN" '{"reason":"API audit escalation test"}'
else
  log_result "GET /collections/:id" "FAIL" "No collection ID" "Empty list"
fi

# ---------------------------------------------------------------------------
# 6. Collateral
# ---------------------------------------------------------------------------
echo ""
echo "--- Collateral ---"
if [ -n "$FIRST_INVOICE_ID" ]; then
  COLLATERAL_BODY="{\"invoice_id\":\"${FIRST_INVOICE_ID}\",\"type\":\"bank_guarantee\",\"description\":\"Warehouse Kampala\",\"estimated_value\":100000000}"
  test_endpoint POST /collateral "POST /collateral" 201 "$CREDIT_TOKEN" "$COLLATERAL_BODY"

  test_endpoint GET "/collateral?invoice_id=${FIRST_INVOICE_ID}" "GET /collateral?invoice_id=:id" 200 "$CREDIT_TOKEN"

  COLLATERAL_RESP=$(curl -s -X GET "${BASE_URL}/collateral?invoice_id=${FIRST_INVOICE_ID}" \
    -H "Authorization: Bearer ${CREDIT_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" 2>/dev/null)
  COLLATERAL_ID=$(json_val "$COLLATERAL_RESP" "id")

  if [ -n "$COLLATERAL_ID" ]; then
    test_endpoint GET "/collateral/${COLLATERAL_ID}" "GET /collateral/:id" 200 "$CREDIT_TOKEN"
    test_endpoint PUT "/collateral/${COLLATERAL_ID}" "PUT /collateral/:id" 200 "$CREDIT_TOKEN" \
      '{"estimated_value":120000000,"description":"Updated value"}'
    test_endpoint DELETE "/collateral/${COLLATERAL_ID}" "DELETE /collateral/:id" 200 "$CREDIT_TOKEN"
  else
    log_result "GET /collateral/:id" "FAIL" "No collateral ID" ""
  fi
else
  log_result "POST /collateral" "FAIL" "No invoice ID" ""
fi

# ---------------------------------------------------------------------------
# 7. Suppliers / Buyers
# ---------------------------------------------------------------------------
echo ""
echo "--- Suppliers & Buyers ---"
test_endpoint GET /suppliers "GET /suppliers" 200 "$CREDIT_TOKEN"

if [ -n "$SUPPLIER_ID" ]; then
  test_endpoint GET "/suppliers/${SUPPLIER_ID}" "GET /suppliers/:id" 200 "$CREDIT_TOKEN"
  test_endpoint GET "/suppliers/${SUPPLIER_ID}/buyers" "GET /suppliers/:id/buyers" 200 "$CREDIT_TOKEN"
  test_endpoint GET "/suppliers/${SUPPLIER_ID}/payments" "GET /suppliers/:id/payments" 200 "$CREDIT_TOKEN"
fi

test_endpoint GET /buyers "GET /buyers" 200 "$CREDIT_TOKEN"

# payments/history (requires supplier_id UUID)
if [ -n "$SUPPLIER_ID" ]; then
  test_endpoint GET "/payments/history?supplier_id=${SUPPLIER_ID}" "GET /payments/history" 200 "$SUPPLIER_TOKEN"
fi

if [ -n "$SUPPLIER_ID" ]; then
  test_endpoint GET "/auth/suppliers/${SUPPLIER_ID}/buyers" "GET /auth/suppliers/:id/buyers" 200 "$SUPPLIER_TOKEN"
fi

# ---------------------------------------------------------------------------
# 8. Onboarding
# ---------------------------------------------------------------------------
echo ""
echo "--- Onboarding ---"
test_endpoint GET /onboarding/admin/suppliers "GET /onboarding/admin/suppliers" 200 "$CREDIT_TOKEN"
test_endpoint GET /onboarding/admin/buyers "GET /onboarding/admin/buyers" 200 "$CREDIT_TOKEN"

if [ -n "$BUYER_ID" ]; then
  test_endpoint GET "/onboarding/admin/buyers/${BUYER_ID}" "GET /onboarding/admin/buyers/:id" 200 "$CREDIT_TOKEN"
fi

# ---------------------------------------------------------------------------
# 9. Payments
# ---------------------------------------------------------------------------
echo ""
echo "--- Payments ---"
test_endpoint GET /payments/pending "GET /payments/pending" 200 "$FINANCE_TOKEN"

# ---------------------------------------------------------------------------
# 10. Facilities
# ---------------------------------------------------------------------------
echo ""
echo "--- Facilities ---"
test_endpoint GET /facilities "GET /facilities" 200 "$FINANCE_TOKEN"
test_endpoint GET /facilities/dashboard "GET /facilities/dashboard" 200 "$FINANCE_TOKEN"

# ---------------------------------------------------------------------------
# 11. Reports
# ---------------------------------------------------------------------------
echo ""
echo "--- Reports ---"
test_endpoint GET /reports/portfolio "GET /reports/portfolio" 200 "$MGMT_TOKEN"
test_endpoint GET /reports/aging "GET /reports/aging" 200 "$CREDIT_TOKEN"
test_endpoint GET /reports/buyer-exposure "GET /reports/buyer-exposure" 200 "$CREDIT_TOKEN"
test_endpoint GET /reports/profit "GET /reports/profit" 200 "$FINANCE_TOKEN"
test_endpoint GET /reports/facilities "GET /reports/facilities" 200 "$FINANCE_TOKEN"
test_endpoint GET /reports/audit-export "GET /reports/audit-export" 200 "$AUDITOR_TOKEN"
test_endpoint GET /reports/regulatory "GET /reports/regulatory" 200 "$COMPLIANCE_TOKEN"

# ---------------------------------------------------------------------------
# 12. Documents
# ---------------------------------------------------------------------------
echo ""
echo "--- Documents ---"
DOC_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X GET \
  "${BASE_URL}/documents/00000000-0000-0000-0000-000000000000/download" \
  -H "Authorization: Bearer ${CREDIT_TOKEN}" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
if [ "$DOC_CODE" = "404" ] || [ "$DOC_CODE" = "400" ]; then
  log_result "GET /documents/:id/download (missing → 404)" "PASS"
else
  log_result "GET /documents/:id/download" "FAIL" "Expected 404, got ${DOC_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 13. Settings
# ---------------------------------------------------------------------------
echo ""
echo "--- Settings ---"
test_endpoint GET /settings/profile "GET /settings/profile" 200 "$SUPPLIER_TOKEN"
test_endpoint PUT /settings/profile "PUT /settings/profile" 200 "$SUPPLIER_TOKEN" \
  '{"full_name":"Updated Supplier Name","phone":"+256770000099"}'
test_endpoint GET /settings/notifications "GET /settings/notifications" 200 "$SUPPLIER_TOKEN"
# Settings notifications returns 204 on success (no content)
NOTIF_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X PUT "${BASE_URL}/settings/notifications" \
  -H "Authorization: Bearer ${SUPPLIER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"email_enabled":true,"sms_enabled":false}' 2>/dev/null)
if [ "$NOTIF_CODE" = "200" ] || [ "$NOTIF_CODE" = "204" ]; then
  log_result "PUT /settings/notifications" "PASS"
else
  log_result "PUT /settings/notifications" "FAIL" "Expected 200/204, got ${NOTIF_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 14. Admin
# ---------------------------------------------------------------------------
echo ""
echo "--- Admin ---"
test_endpoint GET /admin/users "GET /admin/users" 200 "$MGMT_TOKEN"
test_endpoint GET /admin/risk-config "GET /admin/risk-config" 200 "$MGMT_TOKEN"

ADMIN_CREATE_BODY="{\"email\":\"testaudit$(date +%s)@test.ris.co.ug\",\"role\":\"credit_officer\",\"name\":\"Audit Test\"}"
test_endpoint POST /admin/users "POST /admin/users" 201 "$MGMT_TOKEN" "$ADMIN_CREATE_BODY"

ADMIN_USERS=$(curl -s -X GET "${BASE_URL}/admin/users" \
  -H "Authorization: Bearer ${MGMT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
NEW_USER_ID=$(json_val "$ADMIN_USERS" "id")

if [ -n "$NEW_USER_ID" ]; then
  test_endpoint PATCH "/admin/users/${NEW_USER_ID}" "PATCH /admin/users/:id" 200 "$MGMT_TOKEN" \
    '{"status":"inactive"}'
fi

test_endpoint PUT /admin/risk-config/weight_buyer_credit "PUT /admin/risk-config/:key" 200 "$MGMT_TOKEN" \
  '{"value":30}'

# ---------------------------------------------------------------------------
# 15. Verification
# ---------------------------------------------------------------------------
echo ""
echo "--- Verification ---"
test_endpoint GET /verify/admin/invoices/pending-confirmation "GET /verify/pending-confirmation" 200 "$CREDIT_TOKEN"

VERIFY_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X GET \
  "${BASE_URL}/verify/faketoken123" \
  -H "Origin: http://localhost:5173" 2>/dev/null)
if [ "$VERIFY_CODE" = "404" ] || [ "$VERIFY_CODE" = "400" ]; then
  log_result "GET /verify/:token (fake → 404)" "PASS"
else
  log_result "GET /verify/:token" "FAIL" "Expected 404, got ${VERIFY_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
fi

# ---------------------------------------------------------------------------
# 16. Risk Engine & Pricing
# ---------------------------------------------------------------------------
echo ""
echo "--- Risk Engine & Pricing ---"
if [ -n "$FIRST_INVOICE_ID" ]; then
  RISK_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X GET \
    "${BASE_URL}/invoices/${FIRST_INVOICE_ID}/risk-score" \
    -H "Authorization: Bearer ${CREDIT_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" 2>/dev/null)
  if [ "$RISK_CODE" = "200" ] || [ "$RISK_CODE" = "400" ] || [ "$RISK_CODE" = "422" ]; then
    log_result "GET /invoices/:id/risk-score" "PASS"
  else
    log_result "GET /invoices/:id/risk-score" "FAIL" "Got ${RISK_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
  fi

  PRICING_CODE=$(curl -s -o /tmp/mms_response.json -w '%{http_code}' -X GET \
    "${BASE_URL}/invoices/${FIRST_INVOICE_ID}/pricing" \
    -H "Authorization: Bearer ${CREDIT_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" 2>/dev/null)
  if [ "$PRICING_CODE" = "200" ] || [ "$PRICING_CODE" = "400" ] || [ "$PRICING_CODE" = "422" ]; then
    log_result "GET /invoices/:id/pricing" "PASS"
  else
    log_result "GET /invoices/:id/pricing" "FAIL" "Got ${PRICING_CODE}" "$(cat /tmp/mms_response.json | head -c 200)"
  fi
fi

# ==========================================================================
# FINAL REPORT
# ==========================================================================
echo ""
echo "================================================================="
echo " AUDIT COMPLETE"
echo "================================================================="
echo ""
echo " Total endpoints tested: ${TOTAL}"
echo -e " ${GREEN}Passing: ${PASS}${NC}"
echo -e " ${RED}Failing: ${FAIL}${NC}"
echo ""
echo "| Endpoint | Status | Issue | Root Cause |"
echo "|----------|--------|-------|------------|"
echo -e "$RESULTS"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
