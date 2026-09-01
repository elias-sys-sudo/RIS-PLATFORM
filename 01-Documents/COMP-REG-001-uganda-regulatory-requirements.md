# RIS Platform — Uganda Regulatory & Compliance Requirements

**Document ID:** COMP-REG-001  
**Version:** 1.0  
**Date:** March 2026  
**Status:** Approved  
**Owner:** Compliance Officer  
**Legal Review Required:** Yes — verify against current BoU, FIA, PDPA, and URA regulations before go-live

---

## Important Notice

This document reflects Uganda regulatory requirements as understood at the date of publication. Regulations change. The Compliance Officer SHALL verify every requirement herein against the current published regulations from Bank of Uganda (www.bou.or.ug), Financial Intelligence Authority (www.fia.go.ug), Personal Data Protection Office (www.pdpo.go.ug), and Uganda Revenue Authority (www.ura.go.ug) before the platform goes live and at least annually thereafter.

---

## 1. Bank of Uganda — Non-Deposit-Taking Financial Institution Requirements

### 1.1 Licensing and Registration

**COMP-BOU-001:** RIS SHALL obtain a Credit Institution or Tier 4 Microfinance Institution licence from the Bank of Uganda under the Microfinance Institutions Money Lenders Act 2016 (as applicable to invoice discounting operations) OR confirm in writing from legal counsel which licence category applies to invoice discounting specifically before processing any live transaction.

**COMP-BOU-002:** RIS SHALL register as a payment service provider with the Bank of Uganda under the National Payment Systems Act 2020 before operating any mobile money disbursement or collection service on behalf of third parties.

**COMP-BOU-003:** RIS SHALL display its BoU licence number and category on all customer-facing interfaces, terms and conditions, and marketing materials. The licence number SHALL be stored in the system configuration and retrievable for regulatory inspection.

**COMP-BOU-004:** RIS SHALL notify the Bank of Uganda in writing within 30 days of any material change to its business model, ownership structure, key personnel (CEO, CFO, Compliance Officer), or technology infrastructure that processes financial transactions.

### 1.2 Capital Adequacy

**COMP-BOU-005:** RIS SHALL maintain minimum paid-up capital as required by the applicable BoU licence category at all times. The Finance Manager SHALL generate a monthly capital adequacy report confirming compliance. This report SHALL be stored in the system and accessible to the auditor role.

**COMP-BOU-006:** RIS SHALL maintain a capital buffer sufficient to cover at least 15% of the total outstanding funded invoice portfolio at any time. The facilities dashboard SHALL display portfolio exposure against capital buffer in real time for the management role.

**COMP-BOU-007:** RIS SHALL NOT fund any single invoice where the face_value exceeds 25% of RIS's total net capital without prior written approval from the Board of Directors. This limit SHALL be configurable in system settings and enforced at the invoice intake validation stage.

### 1.3 Liquidity Requirements

**COMP-BOU-008:** RIS SHALL maintain liquid assets sufficient to meet all supplier payment commitments within the 72-hour SLA at all times. The facilities module SHALL compute and display the liquidity coverage ratio (available_facility_capacity / committed_pending_payments) daily.

**COMP-BOU-009:** RIS SHALL NOT draw down bank facility funds for any purpose other than funding approved supplier invoices. The system SHALL record the specific invoice_id against every facility drawdown record, making the use of funds traceable and auditable.

**COMP-BOU-010:** RIS SHALL submit quarterly liquidity reports to the Bank of Uganda in the format specified by BoU Supervision. The reporting module SHALL generate a BoU-compliant liquidity report covering: total funded portfolio, facility utilisation, maturity profile, and overdue collections.

### 1.4 Reporting Obligations

**COMP-BOU-011:** RIS SHALL submit monthly financial statements to the Bank of Uganda within 15 days of month-end. Statements SHALL include: total invoices funded, total collected, total overdue, total written off, net interest income, and operating expenses.

**COMP-BOU-012:** RIS SHALL submit an annual audited financial report to the Bank of Uganda within 4 months of financial year-end, prepared by a BoU-approved external auditor.

**COMP-BOU-013:** RIS SHALL notify the Bank of Uganda within 24 hours of: any payment system failure exceeding 2 hours, any suspected fraud above UGX 10,000,000, any data breach affecting customer financial data, or any threat to the institution's ability to meet its payment obligations.

**COMP-BOU-014:** RIS SHALL maintain a complaints register accessible to the compliance_officer role. All customer complaints SHALL be logged, tracked to resolution, and reported to BoU in the quarterly compliance report. Complaints involving amounts above UGX 5,000,000 SHALL be escalated to management within 24 hours.

---

## 2. Financial Intelligence Authority — AML/CFT Obligations

### 2.1 Registration and Designation

**COMP-FIA-001:** RIS SHALL register with the Financial Intelligence Authority as a Reporting Institution under the Anti-Money Laundering Act 2013 (as amended) before processing any financial transaction. Proof of FIA registration SHALL be stored in the system configuration and retrievable for inspection.

**COMP-FIA-002:** RIS SHALL appoint a designated Anti-Money Laundering Compliance Officer (AMLCO) who is a senior employee with authority to file SARs, implement AML controls, and report directly to the Board. The AMLCO's identity SHALL be registered with the FIA and updated within 14 days of any change.

**COMP-FIA-003:** RIS SHALL develop, maintain, and annually review a written AML/CFT Policy approved by the Board of Directors. The policy SHALL be accessible to all staff and a signed acknowledgement of reading SHALL be stored per employee.

### 2.2 Transaction Monitoring Thresholds

**COMP-FIA-004:** RIS SHALL flag any single invoice transaction with a face_value exceeding UGX 100,000,000 (one hundred million Uganda Shillings) for enhanced AML review within 60 seconds of invoice submission, as required under the AML Act 2013 threshold reporting provisions. The AML_FLAG SHALL be created in audit_logs and the compliance_officer notified immediately.

**COMP-FIA-005:** RIS SHALL monitor for structuring — where a supplier submits multiple invoices from the same buyer within a 30-day period where the combined face_value exceeds UGX 100,000,000 even if each individual invoice is below the threshold. The system SHALL detect this pattern and flag it as STRUCTURING_RISK in audit_logs.

**COMP-FIA-006:** RIS SHALL file a Currency Transaction Report (CTR) with the FIA for any transaction — or series of related transactions — involving cash or cash equivalents exceeding UGX 20,000,000 within any 24-hour period. The compliance module SHALL generate CTR-formatted reports for the compliance_officer to review and submit.

**COMP-FIA-007:** RIS SHALL flag any buyer or supplier whose transaction pattern deviates significantly from their historical baseline. Specifically: any month where a supplier's total invoice volume exceeds 300% of their 6-month average SHALL trigger an UNUSUAL_ACTIVITY_FLAG requiring compliance officer review before the invoices are funded.

**COMP-FIA-008:** RIS SHALL maintain a real-time watch list integration against: UN Security Council sanctions lists, OFAC Specially Designated Nationals list, EU consolidated sanctions list, and the FIA Uganda domestic PEP (Politically Exposed Persons) list. Any match SHALL block transaction processing and immediately notify the compliance_officer.

### 2.3 Customer Due Diligence (CDD)

**COMP-FIA-009:** RIS SHALL apply Standard Customer Due Diligence (SCDD) to all new supplier and buyer registrations, collecting: legal entity name, registration number, tax identification number, physical address, beneficial owners (>25% shareholding) with ID documents, and source of business funds declaration.

**COMP-FIA-010:** RIS SHALL apply Enhanced Customer Due Diligence (ECDD) for: (a) any supplier whose total funded invoices exceed UGX 100,000,000 in any 12-month period, (b) any Politically Exposed Person (PEP) or entity with PEP beneficial ownership, (c) any entity from a FATF high-risk jurisdiction, (d) any entity that triggers an AML flag. ECDD SHALL include: source of wealth documentation, senior management approval before onboarding, and enhanced ongoing monitoring.

**COMP-FIA-011:** RIS SHALL perform Simplified Customer Due Diligence (SDCD) is NOT permitted for any transaction above UGX 5,000,000. All RIS transactions by definition exceed this threshold and therefore SCDD is the minimum required for all customers.

**COMP-FIA-012:** RIS SHALL re-perform CDD on existing customers when: their KYC documents expire, their business profile changes materially, an AML flag is raised against them, or 24 months have elapsed since the last CDD review. The system SHALL automatically flag customers due for CDD renewal and block new invoice submissions until renewal is completed.

**COMP-FIA-013:** RIS SHALL conduct beneficial ownership verification for all corporate suppliers and buyers. The system SHALL collect and store: names of all shareholders with >25% ownership, their nationality, ID type and number, and residential address. This information SHALL be encrypted at rest.

### 2.4 SAR Filing Procedure

**COMP-FIA-014:** RIS SHALL file a Suspicious Activity Report (SAR) with the FIA within 24 hours of forming a suspicion that a transaction involves proceeds of crime or terrorist financing, as required under AML Act 2013, Section 16. The 24-hour clock starts from the moment the compliance_officer forms reasonable suspicion — not from the date of the suspicious transaction.

**COMP-FIA-015:** RIS SHALL NOT tip off any customer that a SAR has been filed or is being considered against them, as prohibited under AML Act 2013, Section 18. The system SHALL not display any SAR status to supplier or buyer roles under any circumstances.

**COMP-FIA-016:** The system SHALL enable the compliance_officer to generate a SAR containing: entity identification details, transaction history, AML flags raised, reason for suspicion narrative (free text, minimum 200 characters), supporting documents, and the AMLCO's digital signature. The SAR SHALL be generated in the format required by the FIA goAML system.

**COMP-FIA-017:** RIS SHALL maintain a SAR register accessible only to the compliance_officer and auditor roles. The register SHALL record: date suspicion formed, date SAR filed, FIA reference number received, and outcome if known. SAR records SHALL be retained for 7 years.

**COMP-FIA-018:** RIS SHALL train all staff with access to the platform on AML/CFT obligations annually. Training completion records SHALL be stored in the system and accessible to the compliance_officer. Staff who have not completed current-year AML training SHALL have their accounts flagged for the compliance_officer.

### 2.5 Record Keeping

**COMP-FIA-019:** RIS SHALL retain all CDD documents, transaction records, and AML monitoring records for a minimum of 7 years from the date of the last transaction with the customer, as required under AML Act 2013, Section 19.

**COMP-FIA-020:** RIS SHALL make all AML records available to the FIA within 48 hours of a written request. The system SHALL support bulk export of all records for a specified customer or time period in a machine-readable format (CSV or JSON).

---

## 3. Data Protection and Privacy Act 2019 Uganda

### 3.1 Lawful Basis for Processing

**COMP-PDPA-001:** RIS SHALL process supplier personal data under the following lawful bases under the Data Protection and Privacy Act 2019 (PDPA), Section 13: (a) **Contract performance** — processing necessary to assess, approve, and fund invoices submitted by the supplier; (b) **Legal obligation** — processing required for AML/KYC compliance under the AML Act 2013 and FIA obligations; (c) **Legitimate interest** — fraud detection and risk scoring, where the interest does not override the individual's rights.

**COMP-PDPA-002:** RIS SHALL process buyer personal data under the following lawful bases: (a) **Contract performance** — processing necessary to verify buyer invoice confirmation and manage collections; (b) **Legal obligation** — AML screening and credit reporting obligations; (c) **Legitimate interest** — credit risk assessment and portfolio management.

**COMP-PDPA-003:** RIS SHALL obtain explicit, informed consent from suppliers and buyers before processing their data for any purpose NOT covered by the lawful bases in COMP-PDPA-001 and COMP-PDPA-002. Consent SHALL be: freely given, specific, informed, and unambiguous. Pre-ticked boxes SHALL NOT be used.

**COMP-PDPA-004:** RIS SHALL publish a Privacy Notice accessible on the platform before any data is collected, disclosing: identity of the data controller, purposes of processing, legal basis, data retention periods, third parties data is shared with, and all data subject rights. The Privacy Notice SHALL be reviewed and updated annually.

### 3.2 Data Subject Rights

**COMP-PDPA-005:** RIS SHALL support the right of access (PDPA Section 24). Any supplier or buyer SHALL be able to request a copy of all personal data held about them. The compliance_officer SHALL be able to generate and provide this within 21 days of a verified written request.

**COMP-PDPA-006:** RIS SHALL support the right to rectification (PDPA Section 25). Any supplier or buyer SHALL be able to request correction of inaccurate personal data. Corrections to financial transaction records SHALL require compliance_officer approval and SHALL be logged in audit_logs as DATA_RECTIFICATION.

**COMP-PDPA-007:** RIS SHALL support the right to erasure (PDPA Section 26) where lawful. RIS SHALL NOT erase any data that is: (a) required for AML/FIA record-keeping obligations (7-year minimum retention), (b) required for an active legal dispute, or (c) required for tax records. Where erasure is not possible, RIS SHALL respond to the request explaining the legal basis for retention within 21 days.

**COMP-PDPA-008:** RIS SHALL support the right to object to processing (PDPA Section 27). Where a data subject objects to processing based on legitimate interest, RIS SHALL cease that specific processing unless it can demonstrate compelling legitimate grounds that override the individual's rights.

**COMP-PDPA-009:** RIS SHALL maintain a Data Subject Rights Register accessible to the compliance_officer. Every request SHALL be logged with: date received, type of right exercised, date responded, action taken, and reason if request was declined.

### 3.3 Cross-Border Data Transfer Restrictions

**COMP-PDPA-010:** RIS SHALL NOT transfer personal data of Uganda-based suppliers or buyers to a country outside Uganda or the East African Community unless: (a) the destination country has been assessed by the Personal Data Protection Office (PDPO) as providing adequate protection, OR (b) appropriate safeguards are in place (standard contractual clauses approved by the PDPO), OR (c) the data subject has given explicit consent to the transfer.

**COMP-PDPA-011:** RIS SHALL document all cross-border data flows in a Data Transfer Register. For each flow: the destination country, the data categories transferred, the legal basis for transfer, and the safeguard in place SHALL be recorded. This register SHALL be reviewed quarterly.

**COMP-PDPA-012:** RIS SHALL ensure that any third-party service provider (cloud hosting, email gateway, SMS provider, log aggregation) processing personal data on behalf of RIS signs a Data Processing Agreement (DPA) specifying: the purpose of processing, data categories, security measures, sub-processing restrictions, and return/deletion of data on contract termination.

**COMP-PDPA-013:** RIS SHALL preference data hosting within Uganda or the EAC region. Where data must be hosted outside Uganda (e.g. cloud services), this SHALL be documented in the Privacy Notice and the PDPO notified as required.

### 3.4 Breach Notification

**COMP-PDPA-014:** RIS SHALL notify the Personal Data Protection Office (PDPO) of any personal data breach within 72 hours of becoming aware of it, as required under PDPA Section 30. The notification SHALL include: nature of the breach, categories and approximate number of data subjects affected, likely consequences, and measures taken or proposed to address the breach.

**COMP-PDPA-015:** RIS SHALL notify affected data subjects of a personal data breach without undue delay where the breach is likely to result in high risk to their rights and freedoms. The notification SHALL be in plain language and include: description of the breach, name of the Data Protection Officer, likely consequences, and steps the individual can take to protect themselves.

**COMP-PDPA-016:** RIS SHALL maintain a Data Breach Register accessible to the compliance_officer and auditor. Every breach or suspected breach SHALL be logged regardless of severity, including: date detected, date reported to PDPO, nature of breach, data categories affected, and remediation actions taken. This register SHALL be retained for 7 years.

**COMP-PDPA-017:** RIS SHALL appoint a Data Protection Officer (DPO) who is registered with the Personal Data Protection Office as required under PDPA. The DPO's contact details SHALL be published in the Privacy Notice and accessible to data subjects.

### 3.5 Security and Data Minimisation

**COMP-PDPA-018:** RIS SHALL implement appropriate technical and organisational measures to protect personal data against unauthorised access, loss, or destruction, as required under PDPA Section 19. These measures SHALL include at minimum: AES-256-GCM encryption at rest, TLS 1.3 in transit, access controls by role, and regular security testing (as documented in SEC-REQ-001).

**COMP-PDPA-019:** RIS SHALL implement data minimisation — collecting only personal data that is necessary for the stated purpose. Fields collected SHALL be reviewed annually against their business necessity. Fields no longer necessary SHALL be removed from collection forms and existing data deleted subject to retention requirements.

---

## 4. Uganda Revenue Authority — Tax Obligations

### 4.1 VAT on Discount Fees

**COMP-URA-001:** RIS SHALL charge Value Added Tax (VAT) at the current standard rate (18% as of 2026) on all discount fees charged to suppliers, as the discount fee constitutes consideration for a financial service that is subject to VAT under the Value Added Tax Act (Cap 349). RIS SHALL register for VAT with the URA before processing its first transaction.

**COMP-URA-002:** RIS SHALL issue a VAT-compliant tax invoice to the supplier for each funded invoice. The tax invoice SHALL include: RIS's TIN, RIS's VAT registration number, supplier's TIN, invoice date, invoice number (sequential), description of service (invoice discounting service — invoice reference), face_value, discount_amount (exclusive of VAT), VAT amount (18% of discount_amount), and total amount inclusive of VAT.

**COMP-URA-003:** The system SHALL automatically calculate VAT on every discount_amount and include it in the FeeBreakdown generated by the pricing module. VAT SHALL be stored as a separate field (vat_amount) in the pricing record — not embedded in the discount_amount.

**COMP-URA-004:** RIS SHALL file VAT returns with the URA monthly by the 15th of the following month, declaring all VAT charged on discount fees collected during the month. The reporting module SHALL generate a VAT return summary for the finance_manager to review and submit.

**COMP-URA-005:** RIS SHALL maintain VAT records for a minimum of 5 years as required under the VAT Act. All tax invoices SHALL be stored in the system and retrievable by the auditor role.

### 4.2 Withholding Tax

**COMP-URA-006:** RIS SHALL deduct Withholding Tax (WHT) at the applicable rate on payments made to suppliers where required under the Income Tax Act (Cap 340). As of 2026: WHT on payments to non-individual suppliers is 6% of the gross payment amount where the supplier is a resident company. RIS SHALL verify the applicable rate with a URA-registered tax advisor annually.

**COMP-URA-007:** RIS SHALL deduct WHT from the net_payment_to_supplier before disbursement where applicable. The pricing module SHALL compute: net_payment_after_wht = net_payment_to_supplier - (net_payment_to_supplier × wht_rate). The WHT deduction SHALL be displayed separately in the supplier's fee breakdown.

**COMP-URA-008:** RIS SHALL remit all WHT deducted to the URA by the 15th of the month following the month of deduction. The system SHALL generate a monthly WHT remittance schedule for the finance_manager showing: total WHT deducted by supplier, URA account to credit, and payment reference.

**COMP-URA-009:** RIS SHALL issue a Withholding Tax Certificate (URA Form WHT 1 or equivalent) to each supplier within 30 days of deducting WHT. The certificate SHALL show: RIS's TIN, supplier's TIN, gross payment amount, WHT rate applied, and WHT amount deducted. This certificate allows the supplier to offset the WHT against their own tax liability.

**COMP-URA-010:** RIS SHALL maintain a WHT register per supplier showing all deductions made in a financial year. The register SHALL be accessible to the finance_manager and auditor roles and exportable for URA inspection.

### 4.3 Corporate Income Tax

**COMP-URA-011:** RIS SHALL file corporate income tax returns with the URA annually within 6 months of financial year-end. RIS's taxable income is the net discount fees earned (gross discount - bank interest cost - operating expenses). The reporting module SHALL generate a profit-per-invoice report that serves as the basis for tax computation.

**COMP-URA-012:** RIS SHALL pay provisional tax in two instalments (June and December) based on the estimated annual tax liability. The finance module SHALL track provisional tax payments and alert the finance_manager 30 days before each provisional tax due date.

### 4.4 Tax Compliance Records

**COMP-URA-013:** RIS SHALL maintain all tax records — VAT returns, WHT certificates, tax invoices, and income tax computations — for a minimum of 5 years from the date of filing, as required under the Tax Procedures Code Act 2014.

**COMP-URA-014:** RIS SHALL make all tax records available to the URA within 48 hours of a written request for inspection. The auditor role SHALL be able to export all tax-relevant records for a specified period in CSV format.

**COMP-URA-015:** RIS SHALL register for PAYE (Pay As You Earn) with the URA and deduct income tax from all employee salaries monthly. PAYE returns SHALL be filed by the 15th of the following month. While PAYE is primarily an HR function, the compliance officer SHALL verify monthly that PAYE filings are current as part of the compliance checklist.

---

## 5. Compliance Monitoring and Reporting

### 5.1 Internal Compliance Calendar

**COMP-MON-001:** The system SHALL generate a monthly compliance calendar for the compliance_officer showing all regulatory deadlines in the coming 90 days, including: BoU reporting dates, FIA SAR review deadlines, URA filing dates, CDD renewal dates, and data subject rights response deadlines.

**COMP-MON-002:** The compliance_officer SHALL perform a monthly compliance review covering all requirements in this document and sign off a Compliance Status Report. The report SHALL be stored in the system and accessible to the management and auditor roles.

**COMP-MON-003:** RIS SHALL conduct an annual independent compliance audit by an external auditor with demonstrated AML/CFT expertise. Findings SHALL be reported to the Board within 30 days of completion and remediation plans tracked in the system.

### 5.2 Regulatory Change Management

**COMP-MON-004:** The compliance_officer SHALL subscribe to regulatory update notifications from BoU, FIA, PDPO, and URA. Any regulatory change affecting RIS operations SHALL be assessed within 14 days of publication and a system change request raised if the platform requires updates.

**COMP-MON-005:** This document (COMP-REG-001) SHALL be reviewed and updated at least annually and upon any material regulatory change. The version history SHALL be maintained and previous versions retained for 7 years.

---

## Requirements Summary

| Category              | Requirements                   | Count  |
| --------------------- | ------------------------------ | ------ |
| Bank of Uganda        | COMP-BOU-001 to COMP-BOU-014   | 14     |
| FIA AML/CFT           | COMP-FIA-001 to COMP-FIA-020   | 20     |
| Data Protection Act   | COMP-PDPA-001 to COMP-PDPA-019 | 19     |
| URA Tax               | COMP-URA-001 to COMP-URA-015   | 15     |
| Compliance Monitoring | COMP-MON-001 to COMP-MON-005   | 5      |
| **Total**             |                                | **73** |

---

## Sign-off

| Role                 | Name | Signature | Date |
| -------------------- | ---- | --------- | ---- |
| Compliance Officer   |      |           |      |
| Legal Counsel        |      |           |      |
| Managing Director    |      |           |      |
| External AML Advisor |      |           |      |
