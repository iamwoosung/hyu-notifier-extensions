function timestamp() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
  );
}

function getCallerName() {
  const stack = new Error().stack.split('\n');
  // [0]=Error [1]=getCallerName [2]=log [3]=info|error|warn [4]=실제 호출자
  const line = (stack[4] || stack[3] || '').trim();
  const match = line.match(/^at (?:async )?(\S+)/);
  if (!match) return 'anonymous';
  // "Object.handleCallback" → "handleCallback"
  return match[1].split('.').pop();
}

function log(level, message) {
  const fn = getCallerName();
  const msg = typeof message === 'object' ? JSON.stringify(message) : message;
  console.log(`[${timestamp()}][${fn}][${level}] : ${msg}`);
}

module.exports = {
  info:  (msg) => log('INFO',    msg),
  error: (msg) => log('ERROR',   msg),
  warn:  (msg) => log('WARNING', msg),
};
