// 화면 측정용 가짜 PostgreSQL 서버(measure-ui.cjs 가 띄운다). 진짜 DB 없이 "주소 여러 개 → 붙은 주소 표시"와 서버 Diagram 을 그려 보려고
// pg 드라이버가 쓰는 만큼의 통신(시작 · 인증 없이 통과 · extended 질의)만 흉내 낸다. 어떤 비밀번호든 받는다. 127.0.0.1 에서만 듣는다.
const net = require('node:net');

const TABLES = [['customers', 'BASE TABLE'], ['orders', 'BASE TABLE'], ['order_items', 'BASE TABLE'], ['products', 'BASE TABLE'], ['categories', 'BASE TABLE'], ['active_customers', 'VIEW']];
const COLUMNS = [
  ['customers', 'id', 'bigint'], ['customers', 'email', 'text'], ['customers', 'name', 'text'], ['customers', 'created_at', 'timestamp with time zone'],
  ['orders', 'id', 'bigint'], ['orders', 'customer_id', 'bigint'], ['orders', 'status', 'text'], ['orders', 'total', 'numeric'], ['orders', 'created_at', 'timestamp with time zone'],
  ['order_items', 'order_id', 'bigint'], ['order_items', 'product_id', 'bigint'], ['order_items', 'qty', 'integer'], ['order_items', 'price', 'numeric'],
  ['products', 'id', 'bigint'], ['products', 'category_id', 'bigint'], ['products', 'name', 'text'], ['products', 'price', 'numeric'],
  ['categories', 'id', 'bigint'], ['categories', 'parent_id', 'bigint'], ['categories', 'name', 'text'],
  ['active_customers', 'id', 'bigint'], ['active_customers', 'email', 'text'],
];
const KEYS = [['customers', 'id', '1'], ['orders', 'id', '1'], ['order_items', 'order_id', '1'], ['order_items', 'product_id', '2'], ['products', 'id', '1'], ['categories', 'id', '1']];
const LINKS = [
  ['orders_customer_fk', 'orders', 'customer_id', 'customers', 'id'],
  ['items_order_fk', 'order_items', 'order_id', 'orders', 'id'],
  ['items_product_fk', 'order_items', 'product_id', 'products', 'id'],
  ['products_category_fk', 'products', 'category_id', 'categories', 'id'],
  ['categories_parent_fk', 'categories', 'parent_id', 'categories', 'id'],
];

/** 문장 → [열 이름, 행] 또는 null(행 없는 명령) */
function answer(sql) {
  if (/information_schema\.tables/i.test(sql)) return [['table_name', 'table_type'], TABLES];
  if (/information_schema\.columns/i.test(sql)) return [['table_name', 'column_name', 'data_type'], COLUMNS];
  if (/contype = 'p'/.test(sql)) return [['relname', 'attname', 'ord'], KEYS];
  if (/contype = 'f'/.test(sql)) return [['conname', 'relname', 'attname', 'relname', 'attname'], LINKS];
  if (/^SELECT 1$/i.test(sql.trim())) return [['?column?'], [['1']]];
  if (/^SELECT \* FROM "customers"/i.test(sql)) return [['id', 'email', 'name', 'created_at'], Array.from({ length: 24 }, (_, i) => [String(i + 1), `user${i + 1}@example.com`, `Customer ${i + 1}`, `2026-11-0${(i % 9) + 1} 09:00:00+09`])];
  if (/^\s*SELECT/i.test(sql)) return [['n'], [['42']]];
  return null;
}

const msg = (type, body) => {
  const head = Buffer.alloc(5);
  head.write(type, 0);
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
};
const cstr = (s) => Buffer.from(`${s}\0`);
const int16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

function rowDescription(names) {
  return msg('T', Buffer.concat([int16(names.length), ...names.map((n) => Buffer.concat([cstr(n), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0)]))]));
}
function dataRow(values) {
  return msg('D', Buffer.concat([int16(values.length), ...values.map((v) => (v === null ? int32(-1) : Buffer.concat([int32(Buffer.byteLength(String(v))), Buffer.from(String(v))])))]));
}

function serve(socket) {
  let buf = Buffer.alloc(0);
  let started = false;
  let sql = '';
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (!started) {
        if (buf.length < 8) return;
        const len = buf.readInt32BE(0);
        if (buf.length < len) return;
        const code = buf.readInt32BE(4);
        buf = buf.subarray(len);
        if (code === 80877103) {
          socket.write('N');
          continue;
        }
        started = true;
        socket.write(Buffer.concat([msg('R', int32(0)), msg('S', Buffer.concat([cstr('server_version'), cstr('16.0')])), msg('S', Buffer.concat([cstr('client_encoding'), cstr('UTF8')])), msg('K', Buffer.concat([int32(1), int32(2)])), msg('Z', Buffer.from('I'))]));
        continue;
      }
      if (buf.length < 5) return;
      const type = String.fromCharCode(buf[0]);
      const len = buf.readInt32BE(1);
      if (buf.length < len + 1) return;
      const body = buf.subarray(5, len + 1);
      buf = buf.subarray(len + 1);
      if (type === 'P') {
        const nameEnd = body.indexOf(0);
        sql = body.subarray(nameEnd + 1, body.indexOf(0, nameEnd + 1)).toString();
      } else if (type === 'Q') {
        sql = body.subarray(0, body.length - 1).toString();
        socket.write(Buffer.concat([...reply(false), msg('Z', Buffer.from('I'))]));
      } else if (type === 'S') {
        socket.write(Buffer.concat([msg('1', Buffer.alloc(0)), msg('2', Buffer.alloc(0)), ...reply(true), msg('Z', Buffer.from('I'))]));
      } else if (type === 'X') {
        socket.end();
        return;
      }
    }
  });
  function reply(extended) {
    const a = answer(sql);
    if (a === null) return [...(extended ? [msg('n', Buffer.alloc(0))] : []), msg('C', cstr(sql.trim().split(/\s+/)[0].toUpperCase()))];
    return [rowDescription(a[0]), ...a[1].map(dataRow), msg('C', cstr(`SELECT ${a[1].length}`))];
  }
}

/** 듣기 시작하고 포트를 돌려준다 */
function startFakePg(port) {
  const server = net.createServer(serve);
  server.listen(port, '127.0.0.1');
  server.unref();
  return server;
}

module.exports = { startFakePg };
