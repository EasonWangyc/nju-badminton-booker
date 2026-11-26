# AGENTS.md

## Project

Windows 11 / PowerShell 5.1 application for NJU badminton booking. Node.js controls Edge via playwright-core; Python scripts perform OCR from a local .venv managed by pyproject.toml and uv.lock; Windows Task Scheduler starts scheduled.js at 07:55. setup.ps1 installs dependencies and local state. target.json selects the date, venues, accounts and time priorities. Two accounts seek adjacent one-hour slots; court numbers may differ. Success requires payment and a paid/normal order record.

## Local data

Keep account IDs, passwords, companion names, machine paths, DPAPI credentials, sessions, browser profiles, logs and target dates out of tracked files. Use config.example.json and target.example.json as safe templates; actual values belong only in ignored config.local.json and target.json. Never print credential/session contents or force-add ignored files to Git.

## Changes and verification

Use Windows PowerShell 5.1 syntax. Keep selection, OCR, login, payment and order verification distinct. A submitted order or an opened payment page does not prove booking success. Run the npm logic tests without placing live orders. A new booking date or live reservation requires explicit user authorization. Document new configuration keys in README.md and config.example.json; update uv.lock when Python dependencies change.
