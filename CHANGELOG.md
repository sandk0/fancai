## [1.0.0] - 2026-02-25

### ✨ New Features
- 🎉 **Spoiler-Safe Entity Network**: Added a new spoiler-safe entity network feature to protect users from unintended spoilers
- Improved entity name normalization for more consistent and reliable entity matching

### 🐛 Bug Fixes
- Fixed race conditions in parallel data processing that could cause missing or inconsistent information
- Resolved description extraction and caching issues that prevented content from loading properly
- Fixed cache invalidation to ensure entity data stays current across the platform
- Improved iOS app stability by fixing event listener cleanup
- 🔒 **Email Compatibility**: Fixed password reset emails to display correctly in Gmail
- Enhanced data validation for chapter loading to prevent incomplete content
- Fixed navigation handling in the Progressive Web App for external links
- Improved error recovery and data integrity after database operations

### 🔧 Improvements
- Updated to use current Python date/time functions for better compatibility
- Enhanced logging and error reporting for better diagnostics
- Fixed code quality issues and type annotations across the application