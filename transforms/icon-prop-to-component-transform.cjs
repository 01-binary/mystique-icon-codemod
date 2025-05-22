module.exports = function transformer(file, api) {
  // icon-prop-to-component-transform.cjs
  function getNewIconComponentName(iconString) {
    if (!iconString || typeof iconString !== 'string') {
      return 'UnknownIcon'; // 또는 오류 처리
    }
    let namePart = iconString;
    // 가장 긴/구체적인 접두사부터 순서대로 처리
    if (namePart.startsWith('ic_basic_outline_')) {
      namePart = namePart.substring('ic_basic_outline_'.length);
    } else if (namePart.startsWith('ic_outline_')) {
      namePart = namePart.substring('ic_outline_'.length);
    } else if (namePart.startsWith('ic_basic_')) {
      namePart = namePart.substring('ic_basic_'.length);
    } else if (namePart.startsWith('ic_')) {
      namePart = namePart.substring('ic_'.length);
    }

    const componentNameParts = namePart
      .split(/[_-]/) // 언더스코어(_) 또는 하이픈(-)으로 분리
      .map((part) => {
        if (!part) return '';
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(); // 각 부분을 파스칼 케이스로
      });

    const baseName = componentNameParts.join('');

    if (!baseName) {
      return 'UnknownIcon';
    }

    return baseName; // 'Ic' 접두사 제거
  }

  const j = api.jscodeshift;
  const root = j(file.source);
  console.log(`[DEBUG] Processing file: ${file.path}`);

  let fileHasSkippedItems = false;
  const importedIconNamesFromNewPackage = new Set();

  const TARGET_COMPONENTS = [
    'BasicCardHeader',
    'CardHeader.Icon',
    'ListItem.SupportingIcon',
    'NavBar.Icon',
    'TextButton',
    // 'Tooltip.Contents',
    'TopNavigation.IconButton',
    'BottomNavItem',
  ];

  TARGET_COMPONENTS.forEach((componentName) => {
    console.log(`[DEBUG] Searching for ${componentName} in ${file.path}`);
    root.findJSXElements(componentName).forEach((path) => {
      console.log(
        `[DEBUG] Found ${componentName} at line: ${path.node.loc.start.line}`
      );
      const { openingElement } = path.node;
      let iconPropValue = null;
      let isUnhandledIconProp = false;
      let originalIconAttributeNode = null;

      const iconProp = path.node.openingElement.attributes.find(
        (attr) => attr.name && attr.name.name === 'icon'
      );

      const newAttributes = openingElement.attributes.filter((attr) => {
        if (attr.type === 'JSXAttribute' && attr.name.name === 'icon') {
          originalIconAttributeNode = attr;
          if (
            iconProp &&
            iconProp.value &&
            iconProp.value.type === 'StringLiteral'
          ) {
            console.log(
              `[DEBUG] Found icon prop with string literal: "${iconProp.value.value}"`
            );
            iconPropValue = attr.value.value;
          } else if (
            attr.value.type === 'JSXExpressionContainer' &&
            attr.value.expression.type === 'StringLiteral'
          ) {
            iconPropValue = attr.value.expression.value;
          } else if (
            attr.value.type === 'JSXExpressionContainer' &&
            attr.value.expression.type === 'TemplateLiteral' &&
            attr.value.expression.quasis.length === 1 &&
            attr.value.expression.expressions.length === 0
          ) {
            iconPropValue = attr.value.expression.quasis[0].value.cooked;
          } else {
            isUnhandledIconProp = true;
          }
          return false;
        }
        return true;
      });

      if (originalIconAttributeNode) {
        if (!isUnhandledIconProp && typeof iconPropValue === 'string') {
          const newIconComponentName = getNewIconComponentName(iconPropValue);
          console.log(
            `[DEBUG] Generated new icon component name: ${newIconComponentName}`
          );
          if (newIconComponentName !== 'UnknownIcon') {
            importedIconNamesFromNewPackage.add(newIconComponentName);

            const sizeAttribute = j.jsxAttribute(
              j.jsxIdentifier('size'),
              j.jsxExpressionContainer(j.literal(20))
            );
            console.log(
              `[DEBUG] Attempting to replace ${componentName} with ${newIconComponentName}`
            );
            const newIconJsxElement = j.jsxElement(
              j.jsxOpeningElement(
                j.jsxIdentifier(newIconComponentName),
                [sizeAttribute],
                true
              )
            );
            const newIconProp = j.jsxAttribute(
              j.jsxIdentifier('icon'),
              j.jsxExpressionContainer(newIconJsxElement)
            );
            newAttributes.push(newIconProp);
            openingElement.attributes = newAttributes;
          } else {
            // UnknownIcon의 경우 원본 유지 및 경고
            console.warn(
              `[SKIPPED] File: ${file.path} - Component <${componentName}> at line ${openingElement.loc.start.line} resulted in 'UnknownIcon' for icon value '${iconPropValue}'. Original prop retained.`
            );
            fileHasSkippedItems = true;
            newAttributes.push(originalIconAttributeNode);
            openingElement.attributes = newAttributes;
          }
        } else {
          console.warn(
            `[SKIPPED] File: ${file.path} - Component <${componentName}> at line ${openingElement.loc.start.line} has a dynamic or unhandled 'icon' prop. Original prop retained.`
          );
          fileHasSkippedItems = true;
          newAttributes.push(originalIconAttributeNode);
          openingElement.attributes = newAttributes;
        }
      } else {
        openingElement.attributes = newAttributes;
      }
    });
  });

  if (importedIconNamesFromNewPackage.size > 0) {
    const newSpecificImportSpecifiers = Array.from(
      importedIconNamesFromNewPackage
    )
      .sort()
      .map((name) => j.importSpecifier(j.identifier(name)));

    const newImportDeclaration = j.importDeclaration(
      newSpecificImportSpecifiers,
      j.literal('@3o3/mystique-icons')
    );

    const body = root.get().node.program.body;
    let lastImportIndex = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i].type === 'ImportDeclaration') {
        lastImportIndex = i;
      }
    }
    body.splice(lastImportIndex + 1, 0, newImportDeclaration);
  }

  if (fileHasSkippedItems) {
    const topLevelCommentText = `// TODO: icon-prop-codemod: This file contains components with 'icon' props that were skipped during transformation or resulted in 'UnknownIcon', and require manual review. Please search for '[SKIPPED]' in your console logs for details.`;
    const programNode = root.find(j.Program).get(0).node;

    if (!programNode.comments) {
      programNode.comments = [];
    }

    const alreadyHasFileLevelComment = programNode.comments.some((c) =>
      c.value.includes('icon-prop-codemod:')
    );

    if (!alreadyHasFileLevelComment) {
      programNode.comments.unshift(
        j.commentLine(topLevelCommentText.substring(3))
      );
    }
  }

  return root.toSource({ quote: 'single', trailingComma: true });
};
