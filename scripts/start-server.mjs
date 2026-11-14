// AppSail assigns the listening port at runtime. EC2 and local containers keep
// using PORT (or 3000), so the same image can be used during rollback.
const port = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || '3000';

if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('The HTTP listening port must be an integer between 1 and 65535.');
}

process.env.PORT = port;
process.env.HOSTNAME = '0.0.0.0';

await import('../server.js');
