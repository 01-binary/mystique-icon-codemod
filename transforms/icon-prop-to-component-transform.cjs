module.exports = function transformer(file, api) {
  // 아이콘 문자열을 PascalCase 컴포넌트 이름으로 변환하는 헬퍼 함수
  // 예: 'ic_basic_outline_chevron_left' -> 'OutlineChevronLeft'
  /**
   * Converts an icon string (e.g., 'ic_basic_fill_info') into a PascalCase component name (e.g., 'Info').
   * Handles various prefixes and ensures a default 'UnknownIcon' for invalid inputs.
   * @param {string | null | undefined} iconString - The icon string to convert.
   * @returns {string} The PascalCase component name, or 'UnknownIcon' if conversion fails or input is invalid.
   */
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

    const componentName = namePart
      .split(/[_-]/)
      .map((part) => {
        if (!part) return '';
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join('');
    return componentName ? componentName : 'UnknownIcon'; // Ensure not empty
  }

  /**
   * Extracts the full component name from a JSXElement AST node.
   * For example, for <Button />, it returns 'Button'.
   * For <ListItem.SupportingVisual />, it returns 'ListItem.SupportingVisual'.
   * @param {import('jscodeshift').JSXElement} node - The JSXElement AST node.
   * @returns {string} The component name, or 'UnknownComponent' if the name cannot be determined.
   */
  function getComponentName(node) {
    if (!node || !node.openingElement || !node.openingElement.name)
      return 'UnknownComponent';
    const nameNode = node.openingElement.name;
    if (nameNode.type === 'JSXIdentifier') {
      return nameNode.name;
    }
    if (nameNode.type === 'JSXMemberExpression') {
      let name = '';
      let object = nameNode;
      while (object.type === 'JSXMemberExpression') {
        name = object.property.name + (name ? '.' + name : '');
        object = object.object;
      }
      name = object.name + (name ? '.' + name : '');
      return name;
    }
    return 'UnknownComponent';
  }

  /**
   * Analyzes all attributes of a JSX component and categorizes them for icon transformation.
   * It extracts the icon's string value, attributes from an icon object literal,
   * direct color/size attributes, and any remaining attributes.
   * @param {Array<import('jscodeshift').JSXAttribute | import('jscodeshift').JSXSpreadAttribute>} allAttributes - An array of attribute nodes from the component's opening element.
   * @param {import('jscodeshift').JSCodeshift} j - The jscodeshift API object.
   * @returns {{
   *   iconPropValue: string | null,
   *   iconObjectAttributes: Array<import('jscodeshift').JSXAttribute | import('jscodeshift').JSXSpreadAttribute>,
   *   directAttributes: { color?: import('jscodeshift').JSXAttribute, size?: import('jscodeshift').JSXAttribute },
   *   remainingAttributes: Array<import('jscodeshift').JSXAttribute | import('jscodeshift').JSXSpreadAttribute>,
   *   isUnhandledIconProp: boolean,
   *   iconAttributeNode: import('jscodeshift').JSXAttribute | null
   * }} An object containing parsed attribute information.
   * - `iconPropValue`: The string value of the icon (e.g., 'ic_home').
   * - `iconObjectAttributes`: Attributes from an icon object literal (e.g., `icon={{ icon: 'foo', color: 'blue' }}`).
   * - `directAttributes`: Direct 'color' and 'size' attributes from the outer component.
   * - `remainingAttributes`: All other attributes from the outer component.
   * - `isUnhandledIconProp`: True if the icon prop is in an unhandled format.
   * - `iconAttributeNode`: The original JSXAttribute node for the 'icon' prop.
   */
  function parseComponentAttributes(allAttributes, j) {
    let iconPropValue = null;
    let isUnhandledIconProp = false;
    let iconAttributeNode = null;
    const iconObjectAttributes = []; // Attributes from inside icon={{ key: val }}
    const directAttributes = {}; // Stores direct 'color', 'size' attributes from the outer component
    const remainingAttributes = []; // All other attributes from the outer component

    allAttributes.forEach((attr) => {
      if (attr.type === 'JSXAttribute' && attr.name) {
        const attrName = attr.name.name;
        if (attrName === 'icon') {
          iconAttributeNode = attr;
          const valueNode = attr.value;
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
            if (properties && properties.length > 0) {
              properties.forEach((prop) => {
                if (
                  prop.type === 'ObjectProperty' &&
                  prop.key &&
                  prop.key.type === 'Identifier'
                ) {
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
                      // For identifiers, member expressions etc.
                      jsxValue = j.jsxExpressionContainer(prop.value);
                    }
                    iconObjectAttributes.push(
                      j.jsxAttribute(j.jsxIdentifier(prop.key.name), jsxValue)
                    );
                  }
                } else if (prop.type === 'SpreadElement') {
                  // Handle spread like {...iconProps}
                  iconObjectAttributes.push(
                    j.jsxSpreadAttribute(prop.argument)
                  );
                }
              });
              // If there are properties, but 'icon' string is not found (and not just spreads)
              if (
                !foundIconStringInObject &&
                properties.some(
                  (p) => p.type === 'ObjectProperty' && p.key.name === 'icon'
                )
              ) {
                isUnhandledIconProp = true; // 'icon' key exists but not a string
              } else if (
                !foundIconStringInObject &&
                !properties.some((p) => p.type === 'SpreadElement')
              ) {
                // No 'icon' key at all, and no spread that might provide it
                isUnhandledIconProp = true;
              }
            } else {
              // Empty object {} for icon prop
              isUnhandledIconProp = true;
            }
          } else {
            // e.g. icon={<SomeComponent />} or icon={variableNotObjectOrString}
            isUnhandledIconProp = true;
          }
        } else if (attrName === 'color' || attrName === 'size') {
          // Capture direct color/size
          directAttributes[attrName] = attr;
        } else {
          remainingAttributes.push(attr);
        }
      } else {
        // JSXSpreadAttribute or other types on the outer component
        remainingAttributes.push(attr);
      }
    });

    return {
      iconPropValue,
      iconObjectAttributes, // from icon={{ ... }}
      directAttributes, // { color?: JSXAttr, size?: JSXAttr } from outer component's direct props
      remainingAttributes, // other attributes from outer (already excludes icon, direct color, direct size)
      isUnhandledIconProp,
      iconAttributeNode,
    };
  }

  const j = api.jscodeshift;
  const root = j(file.source);

  let fileHasSkippedItems = false; // Tracks if any item was skipped for logging purposes
  let trulyProblematicSkipOccurred = false; // Tracks if a skip occurred that requires manual review
  const importedIconNamesFromNewPackage = new Set();

  const TARGET_COMPONENTS = [
    'ListItem.SupportingIcon',
    'CardHeader.Icon',
    'NavBar.Icon',
    'TextButton',
    'TopNavigation.IconButton',
    'BottomNavItem',
    'BasicCardHeader',
  ];

  const PROPS_TO_TRANSFER_FROM_OUTER_TO_INNER = ['color']; // Configurable: props like 'color' to move from outer to inner icon

  const COMPONENTS_THAT_DO_NOT_NEED_DEFAULT_SIZE_PROP_FOR_INNER_ICON = new Set([
    'BasicCardHeader',
    'CardHeader.Icon',
    'ListItem.SupportingIcon',
    'TextButton',
    'NavBar.Icon',
    'TopNavigation.IconButton',
  ]);

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
      const currentComponentName = getComponentName(path.node);
      if (currentComponentName === 'TextButton') {
        const finalAttributesForTextButton = [];
        let hasModifiedIconProp = false;

        path.node.openingElement.attributes.forEach((attr) => {
          if (
            attr.type === 'JSXAttribute' &&
            attr.name &&
            (attr.name.name === 'prefixIcon' || attr.name.name === 'suffixIcon')
          ) {
            const iconPropName = attr.name.name;
            let iconValue = null;
            let isAlreadyJsx = false;

            if (attr.value && attr.value.type === 'StringLiteral') {
              iconValue = attr.value.value;
            } else if (
              attr.value &&
              attr.value.type === 'JSXExpressionContainer' &&
              attr.value.expression &&
              attr.value.expression.type === 'JSXElement'
            ) {
              // Already a JSX element, keep as is
              isAlreadyJsx = true;
              finalAttributesForTextButton.push(attr);
            } else {
              // Unhandled type for prefixIcon/suffixIcon value (e.g., variable, complex expression)
              fileHasSkippedItems = true;
              trulyProblematicSkipOccurred = true;
              // console.warn(`[SKIPPED - REVIEW NEEDED] Unhandled ${iconPropName} prop in ${currentComponentName} (Line ${path.node.loc.start.line}):`, j(attr).toSource());
              finalAttributesForTextButton.push(attr); // Keep original unhandled prop
            }

            if (iconValue) {
              // It was a string, needs conversion
              const newIconCompName = getNewIconComponentName(iconValue);
              if (newIconCompName === 'UnknownIcon') {
                fileHasSkippedItems = true;
                trulyProblematicSkipOccurred = true;
                // console.warn(`[SKIPPED - REVIEW NEEDED] Could not determine icon name for ${iconPropName} in ${currentComponentName} (Line ${path.node.loc.start.line}): iconValue='${iconValue}'`, j(attr).toSource());
                finalAttributesForTextButton.push(attr); // Keep original prop if icon name is unknown
              } else {
                importedIconNamesFromNewPackage.add(newIconCompName);
                const newJsxIconElement = j.jsxElement(
                  j.jsxOpeningElement(
                    j.jsxIdentifier(newIconCompName),
                    [],
                    true
                  ) // Self-closing, no props for inner icon
                );
                finalAttributesForTextButton.push(
                  j.jsxAttribute(
                    j.jsxIdentifier(iconPropName),
                    j.jsxExpressionContainer(newJsxIconElement)
                  )
                );
                hasModifiedIconProp = true;
              }
            } else if (
              !isAlreadyJsx &&
              !finalAttributesForTextButton.includes(attr)
            ) {
              // If it wasn't a string, wasn't JSX, and wasn't already pushed due to being unhandled, push original.
              // This case might be redundant if all non-string/non-JSX are considered 'unhandled'.
              finalAttributesForTextButton.push(attr);
            }
          } else {
            finalAttributesForTextButton.push(attr); // Keep other props as they are
          }
        });
        if (
          hasModifiedIconProp ||
          finalAttributesForTextButton.length !==
            path.node.openingElement.attributes.length
        ) {
          path.node.openingElement.attributes = finalAttributesForTextButton;
        }
      } else {
        // Existing logic for other components (icon prop)
        const parsedProps = parseComponentAttributes(
          path.node.openingElement.attributes,
          j
        );

        if (!parsedProps.iconAttributeNode) {
          return; // No 'icon' prop, skip
        }

        if (
          parsedProps.isUnhandledIconProp ||
          parsedProps.iconPropValue === null
        ) {
          fileHasSkippedItems = true; // Mark that a skip occurred for general logging

          let isProblem = true; // Assume it's a problem unless proven otherwise
          if (
            parsedProps.isUnhandledIconProp &&
            parsedProps.iconAttributeNode &&
            parsedProps.iconAttributeNode.value &&
            parsedProps.iconAttributeNode.value.type ===
              'JSXExpressionContainer' &&
            parsedProps.iconAttributeNode.value.expression &&
            parsedProps.iconAttributeNode.value.expression.type === 'JSXElement'
          ) {
            isProblem = false;
          }

          if (isProblem) {
            trulyProblematicSkipOccurred = true;
            // console.warn(`[SKIPPED - REVIEW NEEDED] Unhandled icon prop or null value in ${currentComponentName} (Line ${path.node.loc.start.line}):`, j(parsedProps.iconAttributeNode).toSource());
          } else {
            // console.log(`[INFO] Skipped transformation for ${currentComponentName} (Line ${path.node.loc.start.line}) because icon prop is already a JSX element.`);
          }
          return; // Skip transformation for this element
        }

        const newIconComponentName = getNewIconComponentName(
          parsedProps.iconPropValue
        );
        if (newIconComponentName === 'UnknownIcon') {
          fileHasSkippedItems = true;
          trulyProblematicSkipOccurred = true; // This is definitely a problem requiring review
          // console.warn(`[SKIPPED - REVIEW NEEDED] Could not determine icon name for ${currentComponentName} (Line ${path.node.loc.start.line}): iconValue='${parsedProps.iconPropValue}'`, j(parsedProps.iconAttributeNode).toSource());
          return;
        }

        importedIconNamesFromNewPackage.add(newIconComponentName);

        let innerIconElementProps = [...parsedProps.iconObjectAttributes];

        PROPS_TO_TRANSFER_FROM_OUTER_TO_INNER.forEach((propName) => {
          const directAttr = parsedProps.directAttributes[propName];
          if (
            directAttr &&
            !innerIconElementProps.some(
              (p) => p.name && p.name.name === propName
            )
          ) {
            innerIconElementProps.push(directAttr);
          }
        });

        const sizeProvidedByIconObject = innerIconElementProps.some(
          (p) => p.name && p.name.name === 'size'
        );

        if (!sizeProvidedByIconObject) {
          if (parsedProps.directAttributes.size) {
            innerIconElementProps.push(parsedProps.directAttributes.size);
          } else {
            if (
              !COMPONENTS_THAT_DO_NOT_NEED_DEFAULT_SIZE_PROP_FOR_INNER_ICON.has(
                currentComponentName
              )
            ) {
              innerIconElementProps.push(
                j.jsxAttribute(
                  j.jsxIdentifier('size'),
                  j.jsxExpressionContainer(j.literal(20))
                )
              );
            }
          }
        }

        innerIconElementProps = innerIconElementProps.filter(Boolean);

        const newIconElementNode = j.jsxElement(
          j.jsxOpeningElement(
            j.jsxIdentifier(newIconComponentName),
            innerIconElementProps,
            true
          )
        );

        let finalOuterAttributes = [...parsedProps.remainingAttributes];
        finalOuterAttributes.push(
          j.jsxAttribute(
            j.jsxIdentifier('icon'),
            j.jsxExpressionContainer(newIconElementNode)
          )
        );

        if (parsedProps.directAttributes.color) {
          const colorWasUsedForInner = innerIconElementProps.includes(
            parsedProps.directAttributes.color
          );
          if (!colorWasUsedForInner) {
            finalOuterAttributes.push(parsedProps.directAttributes.color);
          }
        }
        if (parsedProps.directAttributes.size) {
          const sizeWasUsedForInner = innerIconElementProps.includes(
            parsedProps.directAttributes.size
          );
          if (!sizeWasUsedForInner) {
            finalOuterAttributes.push(parsedProps.directAttributes.size);
          }
        }

        path.node.openingElement.attributes = finalOuterAttributes;
      }
    });
  });

  // Handle imports for @3o3/mystique-icons
  if (importedIconNamesFromNewPackage.size > 0) {
    const mystiqueIconsPath = '@3o3/mystique-icons';
    const existingMystiqueImport = root.find(j.ImportDeclaration, {
      source: { value: mystiqueIconsPath },
    });

    const newIconNamesArray = Array.from(importedIconNamesFromNewPackage);

    if (existingMystiqueImport.size() > 0) {
      const importDeclarationToUpdate = existingMystiqueImport.get(0).node;
      const existingSpecifiers = importDeclarationToUpdate.specifiers || [];

      const existingSpecifierNames = new Set(
        existingSpecifiers.map((spec) => spec.imported.name)
      );

      newIconNamesArray.forEach((newName) => {
        existingSpecifierNames.add(newName); // Add new names, Set handles duplicates
      });

      const allSpecifierNamesSorted = Array.from(existingSpecifierNames).sort();

      importDeclarationToUpdate.specifiers = allSpecifierNamesSorted.map(
        (name) => j.importSpecifier(j.identifier(name))
      );
    } else {
      // No existing import from '@3o3/mystique-icons', create a new one.
      const newSpecificImportSpecifiers = newIconNamesArray
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
  }

  // Add top-level TODO comment if necessary
  if (trulyProblematicSkipOccurred) {
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
        j.commentLine(topLevelCommentText.substring(3)) // Remove '// '
      );
    }
  }

  return root.toSource({ quote: 'single', trailingComma: true });
};
