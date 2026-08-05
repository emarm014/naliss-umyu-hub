# Behavioral Rules
- **Strict Scope Adherence**: Always do exactly what the user asks for and nothing more.
- **Suggestions First**: If you have suggestions or ideas for additional features, design improvements, or refactoring, you must suggest them to the user first. Wait for their explicit approval before implementing any unprompted changes.
- **Exhaustive Error Resolution**: Whenever the user provides any error log, stack trace, or Sentry breadcrumb, thoroughly investigate and comprehensively fix not only the reported error, but also audit and resolve all similar potential occurrences, table name mismatches, missing DB permissions/grants, or RPC edge-cases across the entire application and database schema to guarantee it never happens anywhere else in the app.
