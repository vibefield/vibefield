// The pages room's record (EY-0), written by the lab's convert-record.mjs. Never edit it by hand.
// The converter runs again at each EL8, after the record pass.
// Its inputs in draft/browser-spike/ey, by SHA-256:
// 109dc1d64fb043f472339660b3c88630795f097cd61dee68d38aa51beada1924  script-set-0.41.0-p2.json
// 77d252df92d93dfe7ee8e1694e8894cb63e774c2c4003f34b1aeac1434474afa  script-calls-0.41.0-p2.json
// a5bff3fe0c7470915242f7a4705fe36482026b4260b012b9f4798dc1fffc4c49  mcp-tools-0.41.0.json
// 0f16d012822ac12f9b30cf9d93327893b50f46e7a8d3332f9d7bbf69a817f5e4  report-ey-s2-macos.json
// 40d95215596502f96b79b64d1c10f9d0de6b9cf8e68886a90bcc380e47836457  package-lock.json
// 8fcb9077ba97fd477c16fbe280b23bbf8fa5d6a2e4d990891a77c9f923c1f385  notes/bu14-build.md
// No engine text is kept here. Each script body, and each fixed part of a template, is the SHA-256
// and the length of its UTF-8 bytes. Every script form in the set, and every script call the last
// record pass kept, matched this form before it was written. recordedCalls counts the agent's
// calls of every record pass merged into the set, not script calls.
//
// The source build (2026-11-24): `sourceBuild` and `starts` were added here BY HAND, the one departure from the rule
// above, because the converter does not write them yet. They are read from the converter's own input
// notes/bu14-build.md (revision 2, the SHA-256 above): the tag, the patch's SHA-256 and the built darwin-arm64
// binary's SHA-256. `binarySha256` stays the release binary's (the npm package's), which preflight holds the install
// to and which is never started. The converter owes both fields before its next run: the record's schema requires
// them, so a run that drops them fails its parse.

import type { PagesEngineRecordV1, PagesScriptSetV1 } from "./pages";

export const PAGES_ENGINE_RECORD: PagesEngineRecordV1 = {
  v: 1,
  package: "agent-browser",
  version: "0.41.0",
  tagCommit: "1453dd37a40c730fe00f592bc32198a896ff8747",
  npmIntegrity:
    "sha512-XJtBouE5+gGUKyZU1COSmnxU6MKIlmLE2oEyHzl0ohLVOhuRjx9kqQ9vOqxiiW/Gbvi4JPF4Oz777Mn3FGiHAA==",
  binarySha256: {
    "darwin-arm64": "a402fef2489c221b17522aa21f103ca5dc47f00ff5879d4a72c39881544730ab",
  },
  sourceBuild: {
    tagCommit: "1453dd37a40c730fe00f592bc32198a896ff8747",
    patchSha256: "08274e8604452e6cfe1c167d98e6c3d63988e353a6c9cbe462d014140c7810f7",
    binarySha256: {
      "darwin-arm64": "f3a53cbce43fe30875d7d785a6f67647af4e96d987b8ea889fee8f0e68213dea",
    },
  },
  starts: "sourceBuild",
  mcpToolsSha256: "a5bff3fe0c7470915242f7a4705fe36482026b4260b012b9f4798dc1fffc4c49",
  core: [
    {
      engineName: "agent_browser_tools_profiles",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_open",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_read",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_snapshot",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_back",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_forward",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_reload",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_click",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_fill",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_type",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_press",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_check",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_uncheck",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_select",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_scroll",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_wait_ms",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_wait_for_selector",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_wait_for_text",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_wait_for_load",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_screenshot",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_get_text",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_get_url",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_get_title",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_tab_new",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_tab_list",
      readOnlyHint: true,
    },
    {
      engineName: "agent_browser_tab_switch",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_tab_close",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_eval",
      readOnlyHint: false,
    },
    {
      engineName: "agent_browser_close",
      readOnlyHint: false,
    },
  ],
};

export const PAGES_SCRIPT_SET: PagesScriptSetV1 = {
  v: 1,
  engineVersion: "0.41.0",
  recordedCalls: 345,
  unmatchedCallSites: ["interaction.rs:781", "interaction.rs:901"],
  exact: [
    {
      id: "x001",
      sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
      length: 1,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["open", "get url", "tab t1"],
    },
    {
      id: "x002",
      sha256: "305d076223e0260b539f371026511ea91d1537f4b73bd1dce5252dc8fdf5b5a0",
      length: 13,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: [
        "open",
        "get url",
        "snapshot -i",
        "get text",
        "get attr",
        "snapshot -i [flag]",
        "snapshot -i -c -d",
        "snapshot -s",
        "snapshot --delta",
        "read",
        "read [flag]",
        "read index [flag]",
        "wait --url",
        "cookies set",
        "tab t1",
        "back",
        "forward",
      ],
    },
    {
      id: "x003",
      sha256: "a37bf3152178621079ac36f9b6910b026225243abed9739aad8e080ec3ae9b57",
      length: 14,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["open", "get title", "tab t1"],
    },
    {
      id: "x004",
      sha256: "74725063d5035488751fc064797673b3392e301698adf66d7d7cb68f42d95c41",
      length: 3324,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: [
        "snapshot -i",
        "snapshot -i [flag]",
        "snapshot -i -c -d",
        "snapshot -s",
        "snapshot --delta",
        "diff snapshot",
        "screenshot --annotate",
        "screenshot --annotate --full",
      ],
    },
    {
      id: "x005",
      sha256: "e025b27df57e3902116be5036c5838627b392029f7edd1061a587bd031b53040",
      length: 63,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["get text"],
    },
    {
      id: "x006",
      sha256: "f986c03bf1f36d338f70ac7927e015d6e99d2557eaf186a88c698cae3557a5af",
      length: 28,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["fill", "type", "type [flag]"],
    },
    {
      id: "x007",
      sha256: "a046884c0b5bfa6e8f375f80165c3f8548201ca475ccb3e29acea5b19df59daa",
      length: 71,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["get value"],
    },
    {
      id: "x008",
      sha256: "5c21d541c850227d30d8c5b625fb3318cfb4676035e8bd3b2aa52d2e02a67576",
      length: 307,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["frame"],
    },
    {
      id: "x009",
      sha256: "209a6d9dcd3f08f97d3bc5709c157dd8745f980555ff7a710dc945030a0d6415",
      length: 34,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["read", "read [flag]"],
    },
    {
      id: "x010",
      sha256: "dd1b18f9b499c332f2202328606c6ec32b0d9ead95e56f728613f52123ce0f24",
      length: 43,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["get html"],
    },
    {
      id: "x011",
      sha256: "0f9a2aefedbc66fd90de18ef5b35d905d79237232f09c3654c653aab0457aa49",
      length: 34,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["wait --load"],
    },
    {
      id: "x012",
      sha256: "02689135c1980219e732ccbce087984d0795800fa0cfa1f1226df766f14634d5",
      length: 2549,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["find role"],
    },
    {
      id: "x013",
      sha256: "ddb8422082b7a4fb6a013f08097e7338a2e8fdcfd2df995a1c24230ef35fef7c",
      length: 101,
      method: "Runtime.evaluate",
      commandClass: "act",
      commands: ["find text", "find label"],
    },
    {
      id: "x014",
      sha256: "fa3291357696c4537534d22fee2abb6c8109c54c9003694c172bc25c3f7d5690",
      length: 1317,
      method: "Runtime.evaluate",
      commandClass: "act",
      commands: ["find label"],
    },
    {
      id: "x015",
      sha256: "d0940e1b46600cdaa043754a94cceaaacbfce486bd68399894a1797aaebf8942",
      length: 1865,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["select"],
    },
    {
      id: "x016",
      sha256: "5a442c0d95e9f075eacaecd3df9dc8ead862a626c852c2c79795f8c6bca7a49f",
      length: 1618,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["check", "uncheck"],
    },
    {
      id: "x017",
      sha256: "261eab14c778e3e7ee215cd30b7ac7ad3fc245b286e36f5c41863c0291373ff2",
      length: 29,
      method: "Page.createIsolatedWorld",
      commandClass: "read",
      commands: ["a11y"],
    },
    {
      id: "x018",
      sha256: "654835a2d98c5f08b91e00d52d3ec61202aec02ff8f376ecd0b22600e6d6c123",
      length: 575056,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["a11y"],
    },
    {
      id: "x019",
      sha256: "74313779734f0859ac9b0d148ee1e2a7fccabd41e470f32af8cca183d229fd1e",
      length: 2466,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["vitals"],
    },
    {
      id: "x020",
      sha256: "8c728b6c9f2498a86ef9486dd73085d962d52f1bcc9aa76abec127b2064a9cb1",
      length: 348,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["highlight"],
    },
    {
      id: "x021",
      sha256: "3eb2c58374f2585d851e18e2b9e66d6042a3049474aea9dc7802a99c68fa1598",
      length: 3342,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["react tree"],
    },
    {
      id: "x022",
      sha256: "84cad7d9a93d5a948c8701eb7c328991d09b56ae3d8c0d285e4b32a5f1a39dd4",
      length: 288,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["storage local"],
    },
    {
      id: "x023",
      sha256: "7ce94bb1633b534ee00b243684ff15e7915d31c636788961f3203307bf91d21a",
      length: 186,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["screenshot --annotate", "screenshot", "screenshot --annotate --full"],
    },
    {
      id: "x024",
      sha256: "271378463c0e5c1c2d2e90fbdb049013183757fe2ecbe4167e4a7064ac012f23",
      length: 158,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["screenshot --annotate", "screenshot --annotate --full"],
    },
    {
      id: "x025",
      sha256: "cc4f1cb52b1ed99c8f548769cb67ae10762f424dc1088c905f6703ee997429a7",
      length: 33,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["wait --load"],
    },
    {
      id: "x026",
      sha256: "e0a0131bd17e00339a6f265db007db8636023645b0b71cd8bd539f138a87a969",
      length: 168,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["snapshot -i", "screenshot --annotate --full"],
    },
    {
      id: "x027",
      sha256: "4d850b6dbfefeed121f9bfc07d1929f4e4f328ac196382b06456f4c9c7b46dd9",
      length: 39,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["get text"],
    },
    {
      id: "x028",
      sha256: "21c6ef329518a79f80477ce50f1834992f18123f277bcd6dfb56ce2da5d84e43",
      length: 43,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["scroll [flag]"],
    },
    {
      id: "x029",
      sha256: "d151dc8ff0ffff69ec5092bb0af0c1612ded0f366979c021805a29f260cd66aa",
      length: 964,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["check", "uncheck"],
    },
    {
      id: "x030",
      sha256: "d921b5be73f236d82224bf8f8566192bf34419c85821956e31303e62a801f62b",
      length: 602,
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      commands: ["screenshot"],
    },
    {
      id: "x031",
      sha256: "2caf7a5e4480f661189986b7ca25d46c97e507f976fa25ef7d52c1e4a1313520",
      length: 50,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["screenshot --annotate --full"],
    },
    {
      id: "x032",
      sha256: "f5670e05c1c02f79348c9b48e501b3a5fcbb9fd042435503530df2d878aa1b99",
      length: 54,
      method: "Runtime.evaluate",
      commandClass: "read",
      commands: ["tab t1"],
    },
    {
      id: "x033",
      sha256: "2dd94e447c945bfaf07b32b4975de75be2307199a2efc7963820637b031646be",
      length: 14,
      method: "Runtime.evaluate",
      commandClass: "act",
      commands: ["back"],
    },
    {
      id: "x034",
      sha256: "f4a8201da3e796328e2ad20a6c57dfeff6cd07bd0a77fe49214b6b4c897546b7",
      length: 17,
      method: "Runtime.evaluate",
      commandClass: "act",
      commands: ["forward"],
    },
    {
      id: "x035",
      sha256: "755fc7357097775c75fae8619f8a504dd6c38f43ec2ff4e7486dd707d3e57c4c",
      length: 152,
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      commands: ["click [flag]"],
    },
  ],
  templates: [
    {
      id: "find-call-773",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "element.rs:773",
      parts: [
        {
          kind: "template",
          id: "find-css",
        },
      ],
    },
    {
      id: "find-css",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "element.rs:964",
      parts: [
        {
          kind: "fixed",
          sha256: "0731f0f07d55b2a7ad14b077d7421167c02d8e49f5045f99f443287ec316afb2",
          length: 23,
        },
        {
          kind: "json-string",
        },
        {
          kind: "fixed",
          sha256: "ba5ec51d07a4ac0e951608704431d59a02b21a4e951acc10505a8dc407c501ee",
          length: 1,
        },
      ],
    },
    {
      id: "find-doc-css",
      commandClass: "read",
      callSite: "element.rs:964",
      parts: [
        {
          kind: "fixed",
          sha256: "85cb770638b7f9c5133083a70b8e37880d4b149256c3c602adf93c3964ade435",
          length: 18,
        },
        {
          kind: "json-string",
        },
        {
          kind: "fixed",
          sha256: "ba5ec51d07a4ac0e951608704431d59a02b21a4e951acc10505a8dc407c501ee",
          length: 1,
        },
      ],
    },
    {
      id: "frame-center-335",
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      callSite: "element.rs:335",
      parts: [
        {
          kind: "fixed",
          sha256: "7877e9a593c198765f374be8abb010aec99307ca7c5b4ab548a49f201e8f76ee",
          length: 117,
        },
        {
          kind: "template",
          id: "find-doc-css",
        },
        {
          kind: "fixed",
          sha256: "08dbdb2ef6a63b0d7f2cb95528a6495c44d61b3066450654e3c99df98276fdaf",
          length: 3041,
        },
      ],
    },
    {
      id: "frame-object-402",
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      callSite: "element.rs:402",
      parts: [
        {
          kind: "fixed",
          sha256: "c8136b51e99ed80f28c74024fa29c3df769c6f41c866fceb6d17e26344d3efbe",
          length: 77,
        },
        {
          kind: "template",
          id: "find-doc-css",
        },
        {
          kind: "fixed",
          sha256: "7d2a56d554ee7714b52b3fd9dabc3b3e1f34d2641623d83d15c16fb8b65cbbd9",
          length: 3,
        },
      ],
    },
    {
      id: "selector-1044",
      method: "Runtime.evaluate",
      commandClass: "act",
      callSite: "element.rs:1044",
      parts: [
        {
          kind: "fixed",
          sha256: "aeccfa843d70a064ac7ef81e5507d6e1270906ad1de3078c1a14e177c66c0844",
          length: 32,
        },
        {
          kind: "template",
          id: "find-css",
        },
        {
          kind: "fixed",
          sha256: "ca9eab4a1da4fe9c99e9658d59bbdeb3f900fc35670c20841589e23b1f3f5356",
          length: 2990,
        },
      ],
    },
    {
      id: "get-attr-1189",
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      callSite: "element.rs:1189",
      parts: [
        {
          kind: "fixed",
          sha256: "01921ba8d323069d834f2db2244cf2b980a663912c4a7c83f2e4702d61202734",
          length: 38,
        },
        {
          kind: "json-string",
        },
        {
          kind: "fixed",
          sha256: "6b0e5738e46f253d426502ab3792364e5e399fad2667cf49e9cc856b0f107007",
          length: 4,
        },
      ],
    },
    {
      id: "fill-clear-194",
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      callSite: "interaction.rs:194",
      parts: [
        {
          kind: "fixed",
          sha256: "02337bef426345581f9363175ae42b52f972adb815482762436b8d13b0e1971b",
          length: 196,
        },
      ],
    },
    {
      id: "type-clear-263",
      method: "Runtime.callFunctionOn",
      commandClass: "act",
      callSite: "interaction.rs:263",
      parts: [
        {
          kind: "fixed",
          sha256: "c6b9e6d504e70f91412f22ff455bf0fe33e0885e9af36043e9d34b1d3d4a955b",
          length: 212,
        },
      ],
    },
    {
      id: "scroll-449",
      method: "Runtime.evaluate",
      commandClass: "act",
      callSite: "interaction.rs:449",
      parts: [
        {
          kind: "fixed",
          sha256: "2a407addedf100e4ce3895f180b8f24044fc0aa4b4a372f124e8f89c558400e2",
          length: 16,
        },
        {
          kind: "finite-number",
        },
        {
          kind: "fixed",
          sha256: "0a07f659461970d8d8dcefe4fff96a1745599810dc7d47391e95c803b7b2072c",
          length: 2,
        },
        {
          kind: "finite-number",
        },
        {
          kind: "fixed",
          sha256: "ba5ec51d07a4ac0e951608704431d59a02b21a4e951acc10505a8dc407c501ee",
          length: 1,
        },
      ],
    },
    {
      id: "snapshot-href-609",
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      callSite: "snapshot.rs:609",
      parts: [
        {
          kind: "fixed",
          sha256: "ed21cda0ade02a0db955f985a2de1881b130e188ce9b3d13a264d78b3eb72bbd",
          length: 38,
        },
      ],
    },
    {
      id: "wait-visible-7225",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "actions.rs:7225",
      parts: [
        {
          kind: "fixed",
          sha256: "617c8b6ef75e2906af20659279699f110b581e86ad78b7caed12d13b9e6fab7d",
          length: 59,
        },
        {
          kind: "json-string",
        },
        {
          kind: "fixed",
          sha256: "434a0bbb1cb4bd6fd75b792df9c7df27a901a0d515c74a1028d23edfc27bc806",
          length: 272,
        },
      ],
    },
    {
      id: "wait-text-7262",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "actions.rs:7262",
      parts: [
        {
          kind: "fixed",
          sha256: "84114b3624b8657a4249306a2386f9dcb06d687798c0504583bab0737652c578",
          length: 41,
        },
        {
          kind: "json-string",
        },
        {
          kind: "fixed",
          sha256: "ba5ec51d07a4ac0e951608704431d59a02b21a4e951acc10505a8dc407c501ee",
          length: 1,
        },
      ],
    },
    {
      id: "find-text-10865",
      method: "Runtime.evaluate",
      commandClass: "act",
      callSite: "actions.rs:10865",
      parts: [
        {
          kind: "fixed",
          sha256: "c79582915238b19720a88d64fcb936797092d960471b6c604471d2398862bb19",
          length: 197,
        },
        {
          kind: "json-string",
        },
        {
          kind: "fixed",
          sha256: "4d9cd42224f842fe6bbf4b7d1d6d209c9d49a8e4399a66681676d25786c465c8",
          length: 231,
        },
      ],
    },
    {
      id: "annotate-overlay-486",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "screenshot.rs:486",
      parts: [
        {
          kind: "fixed",
          sha256: "4ebcc5823c071174263d0fac3819a2ce4e3aac18962b93707c29098802a02da8",
          length: 33,
        },
        {
          kind: "json-value",
        },
        {
          kind: "fixed",
          sha256: "e5470fb137ce4ec21d51709829c146dc0de1b8a7e41ba829005ba5846671b4b3",
          length: 1415,
        },
      ],
    },
    {
      id: "a11y-finish-214",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "a11y/mod.rs:214",
      parts: [
        {
          kind: "fixed",
          sha256: "4800a6653bbbbb104843a897bc25eccaaa109d97942cb7ee0f64cbd96226d187",
          length: 575136,
        },
        {
          kind: "json-value",
        },
        {
          kind: "fixed",
          sha256: "f58fe8e6b4a96bedf5fd70491f7cd85eba21881918834a341d957ae997dea783",
          length: 372,
        },
      ],
    },
  ],
};
