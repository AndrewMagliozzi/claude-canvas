// Creates a local certificate authority and an HTTPS certificate for this Mac,
// valid for localhost, its .local name and its current LAN IP addresses.
// Nothing is installed anywhere: you trust the CA yourself (see README → Voice).
//
//   npm run certs            create (keeps an existing CA, reissues the server cert)
//   npm run certs -- --force also recreate the CA (you'll need to re-trust it)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'certs')
fs.mkdirSync(dir, { recursive: true })
const p = (f) => path.join(dir, f)
const force = process.argv.includes('--force')

const openssl = ['/opt/homebrew/bin/openssl', '/usr/local/bin/openssl', '/usr/bin/openssl'].find((f) => fs.existsSync(f)) ?? 'openssl'
const run = (args) => execFileSync(openssl, args, { stdio: ['ignore', 'pipe', 'pipe'] })

const ips = Object.values(os.networkInterfaces())
	.flat()
	.filter((i) => i && i.family === 'IPv4')
	.map((i) => i.address)
const host = os.hostname().replace(/\.local$/, '')
const dns = ['localhost', `${host}.local`, host]

if (force || !fs.existsSync(p('rootCA.pem'))) {
	console.log('Creating local certificate authority…')
	fs.writeFileSync(
		p('ca.cnf'),
		`[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = Claude Canvas Local CA (${host})
O = Claude Canvas (local development)
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`
	)
	run(['genrsa', '-out', p('rootCA-key.pem'), '2048'])
	run(['req', '-x509', '-new', '-key', p('rootCA-key.pem'), '-sha256', '-days', '3650', '-out', p('rootCA.pem'), '-config', p('ca.cnf')])
	fs.chmodSync(p('rootCA-key.pem'), 0o600)
}

console.log('Issuing server certificate…')
const alt = [...dns.map((d, i) => `DNS.${i + 1} = ${d}`), ...[...new Set(['127.0.0.1', ...ips])].map((ip, i) => `IP.${i + 1} = ${ip}`)].join('\n')
fs.writeFileSync(
	p('server.cnf'),
	`[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${host}.local
[ext]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
${alt}
`
)
run(['genrsa', '-out', p('server-key.pem'), '2048'])
run(['req', '-new', '-key', p('server-key.pem'), '-out', p('server.csr'), '-config', p('server.cnf')])
// Apple requires TLS server certs to be valid for at most 825 days.
run(['x509', '-req', '-in', p('server.csr'), '-CA', p('rootCA.pem'), '-CAkey', p('rootCA-key.pem'), '-CAcreateserial', '-out', p('server-cert.pem'), '-days', '800', '-sha256', '-extfile', p('server.cnf'), '-extensions', 'ext'])
fs.chmodSync(p('server-key.pem'), 0o600)
fs.rmSync(p('server.csr'), { force: true })

console.log(`\nDone. Certificates are in ${dir}`)
console.log(`  Valid for: ${[...new Set([...dns, '127.0.0.1', ...ips])].join(', ')}`)
console.log('\nNext steps (see README → "Voice input and HTTPS"):')
console.log('  1. npm run dev:https')
console.log(`  2. On the iPad, open http://${ips.find((i) => !i.startsWith('127.')) ?? '<mac-ip>'}:5173/ca.crt and install the profile`)
console.log('  3. iPad Settings → General → About → Certificate Trust Settings → enable "Claude Canvas Local CA"')
console.log('  If your Mac gets a new IP address, run `npm run certs` again (the CA stays the same).\n')
