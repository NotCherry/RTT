# Shared packages

This directory is reserved for code shared by `apps/web` and `apps/api`.

Create a package only when both applications need the same stable contract or utility. Keep app-specific code in its owning application; moving code here without real reuse makes the boundary harder to understand.
