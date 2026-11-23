// Webpack's synchronous loader contract requires CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript')

module.exports = function (source) {
  const file = this.resourcePath.replaceAll('\\', '/')
  if (!/\/src\/(components\/(hp|notes)\/|lib\/notion\/server\/render-blocks\.tsx|app\/(page|privacy\/page|terms\/page)\.tsx)/.test(file) || !file.endsWith('.tsx') || file.includes('__tests__')) return source
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let changed = false
  const result = ts.transform(sf, [(context) => {
    const visit = (node) => {
      const next = ts.visitEachChild(node, visit, context)
      if (!ts.isJsxElement(next) && !ts.isJsxSelfClosingElement(next)) return next
      const opening = ts.isJsxElement(next) ? next.openingElement : next
      const tag = opening.tagName.getText(sf)
      if (!/^[a-z]/.test(tag) && tag !== 'Link') return next
      if (['script', 'style', 'path', 'defs', 'linearGradient', 'stop', 'clipPath'].includes(tag)) return next
      changed = true
      const key = opening.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(sf) === 'key')
      return ts.factory.createJsxElement(
        ts.factory.createJsxOpeningElement(ts.factory.createIdentifier('__PublicTranslation'), undefined,
          ts.factory.createJsxAttributes([ts.factory.createJsxAttribute(ts.factory.createIdentifier('i18nBoundary')), ...(key ? [key] : [])])),
        [next], ts.factory.createJsxClosingElement(ts.factory.createIdentifier('__PublicTranslation')))
    }
    return (node) => ts.visitNode(node, visit)
  }])
  const printed = ts.createPrinter().printFile(result.transformed[0])
  result.dispose()
  if (!changed) return source
  return printed + '\nimport { TranslationBoundary as __PublicTranslation } from "@/lib/i18n/client";\n'
}
