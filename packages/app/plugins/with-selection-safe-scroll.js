const { withMainApplication, CodeGenerator } = require("expo/config-plugins");

const { mergeContents } = CodeGenerator;

/**
 * Under bridgeless, Fabric resolves each component's ViewManager by name with a lazy
 * "first claimant wins" pass over the packages list, and MainReactPackage is always index
 * 0 and lazily owns "RCTScrollView". This prepends PaseoScrollViewPackage to
 * MainApplication.getPackages() so our SelectionSafeScrollViewManager claims
 * "RCTScrollView" first and the conversation list mounts the selection-safe scroll view.
 *
 * mergeContents passes `anchor` straight to String.match, so a string anchor would be
 * regex-interpreted and the literal template text is full of regex metacharacters. An
 * escaped RegExp anchor matches cleanly and addLines throws ERR_NO_MATCH (loud) if the
 * Expo/RN MainApplication template ever changes, instead of silently shipping stock
 * ReactScrollView.
 */
const PACKAGE_FQCN = "expo.modules.paseoscrollview.PaseoScrollViewPackage";
const TAG = "with-selection-safe-scroll";
const ANCHOR = /PackageList\(this\)\.packages\.apply\s*\{/;
const INSERT = `add(0, ${PACKAGE_FQCN}())`;

function withSelectionSafeScroll(config) {
  return withMainApplication(config, (mod) => {
    const merged = mergeContents({
      src: mod.modResults.contents,
      newSrc: INSERT,
      tag: TAG,
      anchor: ANCHOR,
      offset: 1,
      comment: "//",
    });
    mod.modResults.contents = merged.contents;
    return mod;
  });
}

module.exports = withSelectionSafeScroll;
