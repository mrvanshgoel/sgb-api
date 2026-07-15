# Security Policy

## Supported Versions

This project is pre-1.0; security fixes are applied to the latest `main`.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the **Security → Report a vulnerability** tab on the repository).

Please include:

- A description of the issue and its impact
- Steps to reproduce (a proof of concept if possible)
- Any suggested remediation

You can expect an initial acknowledgement within a few days. We will keep you
updated as we investigate and work on a fix, and will credit you in the release
notes unless you prefer to remain anonymous.

## Scope notes

This API ships **no scrapers** and holds **no user credentials**. Live-data
providers (Groww, metals.dev) use the operator's own API keys, read from the
environment at runtime and never logged or persisted. The static SGB dataset is
public information carrying per-record provenance. Reports about credential
handling, dependency vulnerabilities, or request-handling flaws are all in
scope.
