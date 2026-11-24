// Licensed desktop entry point. IDE packages are released separately.
process.env.SYNVOX_LICENSE_ENFORCE = '1';
if (!process.argv.includes('--window')) process.argv.push('--window');
await import('./deepseek.mjs');
