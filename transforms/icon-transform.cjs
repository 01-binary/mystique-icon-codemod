// icon-transform.cjs

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

  let fileHasSkippedIcons = false; // 파일 내에 건너뛴 아이콘이 있는지 추적
  let oldIconDefaultImportName = null;
  const importedIconNamesFromNewPackage = new Set();

  // 1. 기존 '@3o3/mystique-components' 임포트 찾기 및 Icon 컴포넌트의 기본 임포트 이름 저장
  root
    .find(j.ImportDeclaration, {
      source: { value: '@3o3/mystique-components' }, // 실제 경로 별칭에 맞게 수정 필요
    })
    .forEach((path) => {
      // Icon의 로컬 이름이 이전 import 문에서 이미 발견된 경우 중복 처리를 방지합니다.
      if (oldIconDefaultImportName) {
        return;
      }
      // 현재 import 문의 모든 specifier를 순회합니다.
      for (const specifier of path.node.specifiers) {
        // 'Icon'이라는 이름으로 명명된 임포트를 찾습니다 (예: import { Icon } 또는 import { Icon as MyIcon }).
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.name === 'Icon'
        ) {
          oldIconDefaultImportName = specifier.local.name; // 로컬 이름 ('Icon' 또는 'MyIcon')을 저장합니다.
          break; // Icon을 찾았으므로 현재 import 문의 다른 specifier는 더 이상 확인할 필요가 없습니다.
        }
      }
    });

  // Icon 컴포넌트 임포트가 없으면 변환하지 않음
  if (!oldIconDefaultImportName) {
    return file.source;
  }

  // 2. 기존 <Icon ... /> JSXElement 변환
  root.findJSXElements(oldIconDefaultImportName).forEach((path) => {
    const { openingElement } = path.node;
    let iconPropValue = null; // 정적 문자열 아이콘 이름용
    let isUnhandledIconProp = false; // 문자열 리터럴이 아닌 경우

    const newAttributes = [];

    openingElement.attributes.forEach((attr) => {
      if (attr.type === 'JSXAttribute') {
        const attrName = attr.name.name;
        if (attrName === 'icon') {
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
            isUnhandledIconProp = true; // 문자열 리터럴이 아닌 모든 경우
          }
        } else {
          newAttributes.push(attr); // icon이 아닌 다른 속성은 그대로 추가
        }
      } else {
        newAttributes.push(attr); // JSXSpreadAttribute 등
      }
    });

    if (iconPropValue) {
      const newComponentName = getNewIconComponentName(iconPropValue);
      importedIconNamesFromNewPackage.add(newComponentName);

      openingElement.name.name = newComponentName;
      if (path.node.closingElement) {
        path.node.closingElement.name.name = newComponentName;
      }
      openingElement.attributes = newAttributes;
    } else if (
      isUnhandledIconProp ||
      openingElement.name.name === oldIconDefaultImportName
    ) {
      // iconPropValue를 추출하지 못했거나, 처리할 수 없는 icon prop인 경우 경고
      console.warn(
        `[SKIPPED] File: ${file.path} - Component <${oldIconDefaultImportName}> at line ${openingElement.loc.start.line} has a dynamic or unhandled 'icon' prop that requires manual review.`
      );
      fileHasSkippedIcons = true; // 플래그 설정

      // 변환하지 않으므로, 원래 속성들(icon 포함)을 그대로 둡니다.
      // 원래 icon prop을 newAttributes에 다시 추가해줘야 합니다. (openingElement.attributes에서 icon prop을 제외하고 newAttributes를 만들었기 때문)
      const originalIconAttribute = openingElement.attributes.find(
        (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'icon'
      );
      if (originalIconAttribute) {
        newAttributes.unshift(originalIconAttribute);
      }
      openingElement.attributes = newAttributes;
    }
  });

  // // 3. 기존 '~/components/Icon' 임포트 문 제거
  // root
  //   .find(j.ImportDeclaration, {
  //     source: { value: '~/components/Icon' },
  //   })
  //   .forEach((path) => {
  //     const remainingSpecifiers = path.node.specifiers.filter((s) => {
  //       return !(
  //         s.type === 'ImportDefaultSpecifier' &&
  //         s.local.name === oldIconDefaultImportName
  //       );
  //     });

  //     if (remainingSpecifiers.length === 0) {
  //       j(path).remove();
  //     } else {
  //       path.node.specifiers = remainingSpecifiers;
  //     }
  //   });

  // 4. 새로운 아이콘 컴포넌트들을 '@3o3/mystique-icons'에서 임포트
  const newSpecificImportSpecifiers = Array.from(
    importedIconNamesFromNewPackage
  )
    .sort()
    .map((name) => j.importSpecifier(j.identifier(name)));

  const allNewImportSpecifiers = newSpecificImportSpecifiers;

  if (allNewImportSpecifiers.length > 0) {
    const newImportDeclaration = j.importDeclaration(
      allNewImportSpecifiers,
      j.literal('@3o3/mystique-icons') // 새 패키지명 (사용자 변경 사항 반영)
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

  // 파일 최상단에 주석 추가 (만약 건너뛴 아이콘이 있었다면)
  if (fileHasSkippedIcons) {
    const topLevelCommentText = `// TODO: mystique-icon-codemod: This file contains <Icon> components that were skipped during transformation and require manual review. Please search for '[SKIPPED]' in your console logs for details.`;

    const programNode = root.find(j.Program).get(0).node;
    if (!programNode.comments) {
      programNode.comments = [];
    }

    const alreadyHasFileLevelComment = programNode.comments.some((c) =>
      c.value.includes(
        'mystique-icon-codemod: This file contains <Icon> components'
      )
    );

    if (!alreadyHasFileLevelComment) {
      // j.commentLine의 두 번째 인자는 보통 isBlock, 세 번째는 isLeading이지만,
      // recast가 Program 노드의 comments 배열 맨 앞에 추가된 주석을 파일 상단에 잘 배치해줍니다.
      programNode.comments.unshift(
        j.commentLine(topLevelCommentText.substring(3))
      ); // '// ' 제외하고 내용만 전달
    }
  }

  return root.toSource({ quote: 'single', trailingComma: true });
};
