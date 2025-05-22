module.exports = function transformer(file, api) {
  // 아이콘 문자열을 PascalCase 컴포넌트 이름으로 변환하는 헬퍼 함수
  // 예: 'ic_basic_outline_chevron_left' -> 'OutlineChevronLeft'
  function getNewIconComponentName(iconString) {
    if (!iconString || typeof iconString !== 'string') {
      return 'UnknownIcon'; // 또는 오류 처리
    }
    let namePart = iconString;
    if (namePart.startsWith('ic_basic_')) {
      namePart = namePart.substring('ic_basic_'.length);
    } else if (namePart.startsWith('ic_')) {
      // 'ic_basic_' 외의 'ic_' 접두사도 처리
      namePart = namePart.substring('ic_'.length);
    }

    return namePart
      .split('_')
      .map((part) => {
        if (!part) return '';
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join('');
  }

  const j = api.jscodeshift;
  const root = j(file.source);

  let fileHasSkippedItems = false;
  const importedIconNamesFromNewPackage = new Set();

  const TARGET_COMPONENTS = [
    'BasicCardHeader',
    'CardHeader.Icon',
    'ListItem.SupportingIcon',
    'NavBar.Icon',
    'TextButton',
    'TopNavigation.IconButton',
    'BottomNavItem',
  ];

  TARGET_COMPONENTS.forEach((componentName) => {
    let foundElements;
    const parts = componentName.split('.');
    if (parts.length === 2 && parts[0] && parts[1]) {
      foundElements = root.find(j.JSXElement, {
        openingElement: {
          name: {
            type: 'JSXMemberExpression',
            object: { type: 'JSXIdentifier', name: parts[0] },
            property: { type: 'JSXIdentifier', name: parts[1] },
          },
        },
      });
    } else {
      foundElements = root.findJSXElements(componentName);
    }

    foundElements.forEach((path) => {
      const { openingElement } = path.node;
      let iconPropValue = null;
      let isUnhandledIconProp = false;
      let iconAttributeNode = null; // path.node.openingElement.attributes에서 icon prop을 직접 참조
      const attributesOtherThanIcon = [];

      openingElement.attributes.forEach((attr) => {
        if (
          attr.type === 'JSXAttribute' &&
          attr.name &&
          attr.name.name === 'icon'
        ) {
          iconAttributeNode = attr; // icon prop 노드 저장
          const valueNode = attr.value;
          let iconObjectAttributes = []; // Stores attributes from icon={{ key: val }}

          if (valueNode && valueNode.type === 'StringLiteral') {
            iconPropValue = valueNode.value;
          } else if (
            valueNode &&
            valueNode.type === 'JSXExpressionContainer' &&
            valueNode.expression &&
            valueNode.expression.type === 'ObjectExpression'
          ) {
            const properties = valueNode.expression.properties;
            let foundIconStringInObject = false;
            properties.forEach((prop) => {
              if (prop.type === 'Property' && prop.key.type === 'Identifier') {
                // AST for object properties is 'Property'
                if (
                  prop.key.name === 'icon' &&
                  prop.value.type === 'StringLiteral'
                ) {
                  iconPropValue = prop.value.value;
                  foundIconStringInObject = true;
                } else {
                  // Other props like color, size within the icon object
                  let jsxValue;
                  if (prop.value.type === 'StringLiteral') {
                    jsxValue = j.stringLiteral(prop.value.value);
                  } else {
                    // For identifiers, member expressions etc. like szsColors.blue55
                    jsxValue = j.jsxExpressionContainer(prop.value);
                  }
                  iconObjectAttributes.push(
                    j.jsxAttribute(j.jsxIdentifier(prop.key.name), jsxValue)
                  );
                }
              }
            });
            if (!foundIconStringInObject) {
              isUnhandledIconProp = true;
            }
          } else {
            isUnhandledIconProp = true;
          }
        } else {
          attributesOtherThanIcon.push(attr);
        }
      });

      if (!iconAttributeNode) {
        return; // 다음 요소로
      }
      if (isUnhandledIconProp || iconPropValue === null) {
        fileHasSkippedItems = true;
        return;
      }

      const newIconComponentName = getNewIconComponentName(iconPropValue);

      if (newIconComponentName === 'UnknownIcon') {
        fileHasSkippedItems = true;
        return;
      }
      importedIconNamesFromNewPackage.add(newIconComponentName);

      // Unified logic to transform the 'icon' prop into a JSX element for all target components.
      const PROPS_TO_TRANSFER_TO_INNER_ICON = ['color'];
      const attributesFromOuterComponentToTransfer = [];
      const remainingAttributesForOuterComponent = [];

      attributesOtherThanIcon.forEach((attr) => {
        if (
          attr.type === 'JSXAttribute' &&
          attr.name &&
          PROPS_TO_TRANSFER_TO_INNER_ICON.includes(attr.name.name)
        ) {
          attributesFromOuterComponentToTransfer.push(attr);
        } else {
          remainingAttributesForOuterComponent.push(attr);
        }
      });

      // Start with props from icon={{...}} object, these have higher priority
      let basePropsForInnerIcon = [...iconObjectAttributes];

      // Add props from outer component (e.g. direct color prop) if not already defined in iconObjectAttributes
      attributesFromOuterComponentToTransfer.forEach((attrToTransfer) => {
        if (
          !basePropsForInnerIcon.some(
            (baseAttr) => baseAttr.name.name === attrToTransfer.name.name
          )
        ) {
          basePropsForInnerIcon.push(attrToTransfer);
        }
      });

      let innerIconElementProps = [...basePropsForInnerIcon];

      // Size prop logic: 1. from iconObject/outerTransfer, 2. from remainingOuter, 3. default 20
      let sizeAttributeForInnerIcon = innerIconElementProps.find(
        (attr) => attr.name && attr.name.name === 'size'
      );

      if (!sizeAttributeForInnerIcon) {
        const outerSizeAttribute = remainingAttributesForOuterComponent.find(
          (attr) => attr.name && attr.name.name === 'size'
        );
        if (outerSizeAttribute) {
          sizeAttributeForInnerIcon = outerSizeAttribute;
          const idx =
            remainingAttributesForOuterComponent.indexOf(outerSizeAttribute);
          if (idx > -1) remainingAttributesForOuterComponent.splice(idx, 1); // Remove from outer if moved
        }
      }

      if (sizeAttributeForInnerIcon) {
        // Ensure size is only added once, even if found and pushed here
        if (!innerIconElementProps.includes(sizeAttributeForInnerIcon)) {
          innerIconElementProps.push(sizeAttributeForInnerIcon);
        }
      } else {
        innerIconElementProps.push(
          j.jsxAttribute(
            j.jsxIdentifier('size'),
            j.jsxExpressionContainer(j.literal(20))
          )
        );
      }

      // Ensure props are unique in case 'color' (or other transferred props) were also in attributesOtherThanIcon
      // For now, the logic correctly separates them, so direct sort is fine.
      innerIconElementProps.sort((a, b) =>
        a.name.name.localeCompare(b.name.name)
      );

      const innerIconOpeningElement = j.jsxOpeningElement(
        j.jsxIdentifier(newIconComponentName),
        innerIconElementProps,
        true // selfClosing
      );
      const newInnerIconJsxElement = j.jsxElement(innerIconOpeningElement);
      const newIconPropForOuter = j.jsxAttribute(
        j.jsxIdentifier('icon'),
        j.jsxExpressionContainer(newInnerIconJsxElement)
      );

      path.node.openingElement.attributes = [
        newIconPropForOuter,
        ...remainingAttributesForOuterComponent,
      ].sort((a, b) => {
        if (a.name.name === 'icon') return -1; // Keep 'icon' prop first for readability
        if (b.name.name === 'icon') return 1;
        return a.name.name.localeCompare(b.name.name);
      });
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
