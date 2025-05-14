// icon-transform.cjs
const {
  ASTPath,
  ImportDeclaration,
  JSXAttribute,
  JSXElement,
  JSXIdentifier,
  JSXOpeningElement,
} = require('jscodeshift');

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

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  let oldIconDefaultImportName = null;
  const importedIconNamesFromNewPackage = new Set();

  // 1. 기존 '~/components/Icon' 임포트 찾기 및 Icon 컴포넌트의 기본 임포트 이름 저장
  root
    .find(j.ImportDeclaration, {
      source: { value: '~/components/Icon' }, // 실제 경로 별칭에 맞게 수정 필요
    })
    .forEach((path) => {
      const defaultSpecifier = path.node.specifiers.find(
        (s) => s.type === 'ImportDefaultSpecifier'
      );
      if (defaultSpecifier) {
        oldIconDefaultImportName = defaultSpecifier.local.name; // 예: 'Icon'
      }
    });

  // Icon 컴포넌트 임포트가 없으면 변환하지 않음
  if (!oldIconDefaultImportName) {
    return file.source;
  }

  // 2. 기존 <Icon ... /> JSXElement 변환
  root.findJSXElements(oldIconDefaultImportName).forEach((path) => {
    const { openingElement } = path.node;
    let iconPropValue = null;
    let colorPropExists = false;
    const newAttributes = [];

    openingElement.attributes.forEach((attr) => {
      if (attr.type === 'JSXAttribute') {
        const attrName = attr.name.name;
        if (attrName === 'icon') {
          // 'icon' prop 값 추출 (단순 문자열 리터럴만 처리)
          if (attr.value.type === 'StringLiteral') {
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
            // 동적 아이콘 이름 (예: `icon={`...${variable}`}`)은 자동 변환이 복잡하므로 경고.
            console.warn(
              `[SKIPPED] File: ${file.path} - Component <${oldIconDefaultImportName}> at line ${openingElement.loc.start.line} has a dynamic 'icon' prop that requires manual review.`
            );
          }
        } else {
          if (attrName === 'color') {
            colorPropExists = true;
          }
          newAttributes.push(attr); // icon이 아닌 다른 속성은 그대로 추가
        }
      } else {
        newAttributes.push(attr); // JSXSpreadAttribute 등
      }
    });

    if (iconPropValue) {
      const newComponentName = getNewIconComponentName(iconPropValue);
      importedIconNamesFromNewPackage.add(newComponentName);

      // JSX 태그 이름 변경
      openingElement.name.name = newComponentName;
      if (path.node.closingElement) {
        path.node.closingElement.name.name = newComponentName;
      }

      // color prop이 명시적으로 없었다면 'currentColor'로 설정
      if (!colorPropExists) {
        newAttributes.push(
          j.jsxAttribute(
            j.jsxIdentifier('color'),
            j.stringLiteral('currentColor')
          )
        );
      }
      openingElement.attributes = newAttributes; // 재구성된 속성으로 교체
    } else if (openingElement.name.name === oldIconDefaultImportName) {
      // iconPropValue를 추출하지 못했고, 아직 변환되지 않은 <Icon /> 태그인 경우
      // (위에서 dynamic 'icon' prop 경고가 이미 출력되었을 수 있음)
    }
  });

  // 3. 기존 '~/components/Icon' 임포트 문 제거
  root
    .find(j.ImportDeclaration, {
      source: { value: '~/components/Icon' },
    })
    .forEach((path) => {
      const remainingSpecifiers = path.node.specifiers.filter((s) => {
        return !(
          s.type === 'ImportDefaultSpecifier' &&
          s.local.name === oldIconDefaultImportName
        );
      });

      if (remainingSpecifiers.length === 0) {
        j(path).remove();
      } else {
        path.node.specifiers = remainingSpecifiers;
      }
    });

  // 4. 새로운 아이콘 컴포넌트들을 '@mystique/icons'에서 임포트
  if (importedIconNamesFromNewPackage.size > 0) {
    const newImportSpecifiers = Array.from(importedIconNamesFromNewPackage)
      .sort()
      .map((name) => j.importSpecifier(j.identifier(name)));

    const newImportDeclaration = j.importDeclaration(
      newImportSpecifiers,
      j.literal('@mystique/icons') // 새 패키지명
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

  return root.toSource({ quote: 'single', trailingComma: true });
}
