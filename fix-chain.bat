@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: MMS Platform - Automated Integration Fix Chain (with retry)
:: ============================================================
:: NOTE: This chain covers integration fixes across 12 steps.
::   Steps do NOT map 1:1 to the 13 workflow stages. The
::   settlements module (Stage 13) and notifications module
::   are handled outside this chain.
:: SETUP:
::   1. Place this file + prompts\ folder in MMS-Platform root
::   2. Start backend: npm run dev (in separate terminal)
::   3. Set ANTHROPIC_API_KEY in environment
::   4. Run: fix-chain.bat
:: ============================================================

echo.
echo  ============================================
echo   MMS Platform - Integration Fix Chain
echo   12 steps with auto-retry
echo  ============================================
echo.

if not exist "package.json" (
    echo [ERROR] Run from MMS-Platform root directory.
    exit /b 1
)

if not exist "prompts\step-01.txt" (
    echo [ERROR] prompts\step-01.txt not found.
    echo         Make sure the prompts folder is in MMS-Platform root.
    exit /b 1
)

if not exist "scripts\audit" mkdir scripts\audit
if not exist "logs" mkdir logs

for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value') do set DT=%%i
set LOGFILE=logs\fix-chain-%DT:~0,8%-%DT:~8,4%.log
set MAX_RETRIES=3
set TOOLS=Bash,Read,Write,Edit,MultiEdit
set TOTAL_PASS=0
set TOTAL_FAIL=0

echo  Log: %LOGFILE%
echo  Max retries per step: %MAX_RETRIES%
echo  Started: %date% %time%
echo.
echo Started: %date% %time% > %LOGFILE%

:: ============================================================
:: Run all 12 steps (zero-padded to match filenames)
:: ============================================================

call :run_step 01 "Extracting backend routes"
call :run_step 02 "Extracting frontend API calls"
call :run_step 03 "Building case transformer"
call :run_step 04 "Fixing URL and field mismatches"
call :run_step 05 "Fixing response type mismatches"
call :run_step 06 "Verifying auth flow"
call :run_step 07 "Verifying dashboard and invoices"
call :run_step 08 "Verifying collections"
call :run_step 09 "Verifying collateral and documents"
call :run_step 10 "Verifying suppliers"
call :run_step 11 "Verifying admin and settings"
call :run_step 12 "Generating final report"

:: ============================================================
:: Summary
:: ============================================================
echo.
echo  ============================================
echo   COMPLETE
echo  ============================================
echo  Passed: %TOTAL_PASS%/12
echo  Failed: %TOTAL_FAIL%/12
echo  Log:    %LOGFILE%
echo  Report: scripts\audit\SYSTEM-STATUS.md
echo  ============================================
echo.
echo Passed: %TOTAL_PASS%/12 >> %LOGFILE%
echo Failed: %TOTAL_FAIL%/12 >> %LOGFILE%

pause
exit /b 0

:: ============================================================
:: :run_step  -  Runs a step with retry logic
::   %1 = step number (zero-padded: 01, 02, ... 12)
::   %2 = description
:: ============================================================
:run_step
set STEP_NUM=%~1
set STEP_DESC=%~2
set ATTEMPT=1
set PROMPT_FILE=prompts\step-%STEP_NUM%.txt

if not exist "!PROMPT_FILE!" (
    echo [%STEP_NUM%/12] SKIPPED - !PROMPT_FILE! not found
    echo [%STEP_NUM%/12] SKIPPED - file not found >> %LOGFILE%
    set /a TOTAL_FAIL+=1
    goto :eof
)

:retry_loop
if !ATTEMPT! gtr %MAX_RETRIES% goto :step_failed

if !ATTEMPT! equ 1 (
    echo [%STEP_NUM%/12] %STEP_DESC%...
    set "INSTRUCTION=You are working in this project directory. Execute the task described in the input above."
) else (
    echo [%STEP_NUM%/12] Retry !ATTEMPT!/%MAX_RETRIES%...
    set "INSTRUCTION=You are working in this project directory. The previous attempt failed. Diagnose what went wrong, fix it, then re-execute the task from the input above."
)

echo. >> %LOGFILE%
echo === STEP %STEP_NUM%/12 [attempt !ATTEMPT!]: %STEP_DESC% === >> %LOGFILE%

type "!PROMPT_FILE!" | claude -p "!INSTRUCTION!" --allowedTools "%TOOLS%" --max-turns 40 --output-format text >> %LOGFILE% 2>&1

if !ERRORLEVEL! neq 0 (
    echo [%STEP_NUM%/12] Attempt !ATTEMPT! failed >> %LOGFILE%
    set /a ATTEMPT+=1
    goto :retry_loop
)

echo [%STEP_NUM%/12] DONE
echo [%STEP_NUM%/12] PASSED >> %LOGFILE%
set /a TOTAL_PASS+=1
goto :eof

:step_failed
echo [%STEP_NUM%/12] FAILED after %MAX_RETRIES% attempts
echo [%STEP_NUM%/12] FAILED after %MAX_RETRIES% attempts >> %LOGFILE%
set /a TOTAL_FAIL+=1
goto :eof
