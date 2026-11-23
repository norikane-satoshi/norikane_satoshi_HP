/* eslint-disable @typescript-eslint/no-require-imports -- Shared with Next's synchronous configuration loader. */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function generate(root) {
  const files = {}
  const scan = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`
      if (entry.isDirectory()) { if (!entry.name.startsWith('__')) scan(name); continue }
      if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) continue
      const text = fs.readFileSync(path.join(root, name), 'utf8')
      const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
      const strings = new Set()
      const visit = (node) => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /[\u3040-\u30ff\u3400-\u9fff]/u.test(node.text)) strings.add(node.text)
        if (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent) && ['latin', 'label', 'title', 'caption'].includes(node.parent.name.getText(sf))) strings.add(node.text)
        if (ts.isJsxText(node)) {
          const value = node.text.split(/\r?\n/).map((line, i, all) => i === 0 ? line.trimEnd() : i === all.length - 1 ? line.trimStart() : line.trim()).filter(Boolean).join(' ')
          if (/[A-Za-z\u3040-\u9fff]/u.test(value)) strings.add(value)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
      files[name] = [...strings]
    }
  }
  scan('src/components/hp')
  scan('src/components/notes')
  scan('src/lib/hp')
  scan('src/lib/notes/domain')
  const target = path.join(root, 'src/lib/i18n/source.generated.json')
  const value = JSON.stringify(files)
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== value) fs.writeFileSync(target, value)
}
module.exports = { generate }
