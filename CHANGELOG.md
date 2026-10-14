# Changelog

All notable changes to BELL PR are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BELL PR follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Draft license terms (EULA), privacy policy, terms of sale, refund policy
  and security policy. They are pending counsel review and not yet in force.
- A generic systemd user unit in `contrib/systemd/bell-pr.service`.

### Changed

- `.env.example` is in English, and the settings that only matter for
  developing BELL PR itself are grouped at the end.

### Removed

- The machine-specific deployment files in `deploy/`.
