import fs from 'fs'
import path from 'path'

export function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ]
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const text = fs.readFileSync(envPath, 'utf8')
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eq = trimmed.indexOf('=')
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim()
            const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
            if (process.env[key] === undefined || process.env[key] === '' || process.env[key] === 'your_api_key_here') {
              process.env[key] = val
            }
          }
        }
        break
      } catch (e) {}
    }
  }
}
