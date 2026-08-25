#![allow(clippy::redundant_closure_call)]
#![allow(clippy::needless_lifetimes)]
#![allow(clippy::match_single_binding)]
#![allow(clippy::clone_on_copy)]

#[doc = r" Error types."]
pub mod error {
    #[doc = r" Error from a `TryFrom` or `FromStr` implementation."]
    pub struct ConversionError(::std::borrow::Cow<'static, str>);
    impl ::std::error::Error for ConversionError {}
    impl ::std::fmt::Display for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl ::std::fmt::Debug for ConversionError {
        fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> Result<(), ::std::fmt::Error> {
            ::std::fmt::Debug::fmt(&self.0, f)
        }
    }
    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value.into())
        }
    }
    impl From<String> for ConversionError {
        fn from(value: String) -> Self {
            Self(value.into())
        }
    }
}
#[doc = "`CellEndpointSet`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"controlUrl\","]
#[doc = "    \"framesUrl\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"controlUrl\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"pattern\": \"^wss?:\\\\/\\\\/(127\\\\.0\\\\.0\\\\.1|\\\\[::1\\\\]|localhost)(:\\\\d{1,5})?(\\\\/[^?#]*)?$\""]
#[doc = "    },"]
#[doc = "    \"framesUrl\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"pattern\": \"^wss?:\\\\/\\\\/(127\\\\.0\\\\.0\\\\.1|\\\\[::1\\\\]|localhost)(:\\\\d{1,5})?(\\\\/[^?#]*)?$\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct CellEndpointSet {
    #[serde(rename = "controlUrl")]
    pub control_url: CellEndpointSetControlUrl,
    #[serde(rename = "framesUrl")]
    pub frames_url: CellEndpointSetFramesUrl,
}
impl CellEndpointSet {
    pub fn builder() -> builder::CellEndpointSet {
        Default::default()
    }
}
#[doc = "`CellEndpointSetControlUrl`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"pattern\": \"^wss?:\\\\/\\\\/(127\\\\.0\\\\.0\\\\.1|\\\\[::1\\\\]|localhost)(:\\\\d{1,5})?(\\\\/[^?#]*)?$\""]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CellEndpointSetControlUrl(::std::string::String);
impl ::std::ops::Deref for CellEndpointSetControlUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CellEndpointSetControlUrl> for ::std::string::String {
    fn from(value: CellEndpointSetControlUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CellEndpointSetControlUrl {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new(
                    "^wss?:\\/\\/(127\\.0\\.0\\.1|\\[::1\\]|localhost)(:\\d{1,5})?(\\/[^?#]*)?$",
                )
                .unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err ("doesn't match pattern \"^wss?:\\/\\/(127\\.0\\.0\\.1|\\[::1\\]|localhost)(:\\d{1,5})?(\\/[^?#]*)?$\"" . into ()) ;
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for CellEndpointSetControlUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CellEndpointSetControlUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CellEndpointSetControlUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for CellEndpointSetControlUrl {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`CellEndpointSetFramesUrl`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"pattern\": \"^wss?:\\\\/\\\\/(127\\\\.0\\\\.0\\\\.1|\\\\[::1\\\\]|localhost)(:\\\\d{1,5})?(\\\\/[^?#]*)?$\""]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct CellEndpointSetFramesUrl(::std::string::String);
impl ::std::ops::Deref for CellEndpointSetFramesUrl {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<CellEndpointSetFramesUrl> for ::std::string::String {
    fn from(value: CellEndpointSetFramesUrl) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for CellEndpointSetFramesUrl {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new(
                    "^wss?:\\/\\/(127\\.0\\.0\\.1|\\[::1\\]|localhost)(:\\d{1,5})?(\\/[^?#]*)?$",
                )
                .unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err ("doesn't match pattern \"^wss?:\\/\\/(127\\.0\\.0\\.1|\\[::1\\]|localhost)(:\\d{1,5})?(\\/[^?#]*)?$\"" . into ()) ;
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for CellEndpointSetFramesUrl {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for CellEndpointSetFramesUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for CellEndpointSetFramesUrl {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for CellEndpointSetFramesUrl {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ClientKind`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"shell-main\","]
#[doc = "    \"renderer\","]
#[doc = "    \"plugin-worker\","]
#[doc = "    \"ios\","]
#[doc = "    \"peer-fieldd\","]
#[doc = "    \"mcp-agent\","]
#[doc = "    \"fieldd\","]
#[doc = "    \"field-native\","]
#[doc = "    \"debug\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ClientKind {
    #[serde(rename = "shell-main")]
    ShellMain,
    #[serde(rename = "renderer")]
    Renderer,
    #[serde(rename = "plugin-worker")]
    PluginWorker,
    #[serde(rename = "ios")]
    Ios,
    #[serde(rename = "peer-fieldd")]
    PeerFieldd,
    #[serde(rename = "mcp-agent")]
    McpAgent,
    #[serde(rename = "fieldd")]
    Fieldd,
    #[serde(rename = "field-native")]
    FieldNative,
    #[serde(rename = "debug")]
    Debug,
}
impl ::std::fmt::Display for ClientKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::ShellMain => f.write_str("shell-main"),
            Self::Renderer => f.write_str("renderer"),
            Self::PluginWorker => f.write_str("plugin-worker"),
            Self::Ios => f.write_str("ios"),
            Self::PeerFieldd => f.write_str("peer-fieldd"),
            Self::McpAgent => f.write_str("mcp-agent"),
            Self::Fieldd => f.write_str("fieldd"),
            Self::FieldNative => f.write_str("field-native"),
            Self::Debug => f.write_str("debug"),
        }
    }
}
impl ::std::str::FromStr for ClientKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "shell-main" => Ok(Self::ShellMain),
            "renderer" => Ok(Self::Renderer),
            "plugin-worker" => Ok(Self::PluginWorker),
            "ios" => Ok(Self::Ios),
            "peer-fieldd" => Ok(Self::PeerFieldd),
            "mcp-agent" => Ok(Self::McpAgent),
            "fieldd" => Ok(Self::Fieldd),
            "field-native" => Ok(Self::FieldNative),
            "debug" => Ok(Self::Debug),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ClientKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ClientKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ClientKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`DesiredState`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"generation\","]
#[doc = "    \"terminals\","]
#[doc = "    \"workers\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"generation\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"meshConfig\": {"]
#[doc = "      \"$ref\": \"#/definitions/MeshConfig\""]
#[doc = "    },"]
#[doc = "    \"observedBootId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"terminals\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/DesiredTerminal\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"workers\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/DesiredWorker\""]
#[doc = "      }"]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DesiredState {
    pub generation: i64,
    #[serde(
        rename = "meshConfig",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub mesh_config: ::std::option::Option<MeshConfig>,
    #[serde(
        rename = "observedBootId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub observed_boot_id: ::std::option::Option<::std::string::String>,
    pub terminals: ::std::vec::Vec<DesiredTerminal>,
    pub workers: ::std::vec::Vec<DesiredWorker>,
}
impl DesiredState {
    pub fn builder() -> builder::DesiredState {
        Default::default()
    }
}
#[doc = "`DesiredTerminal`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"sessionId\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"persistence\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"sessionId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DesiredTerminal {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub persistence: ::std::option::Option<::std::string::String>,
    #[serde(rename = "sessionId")]
    pub session_id: ::std::string::String,
}
impl DesiredTerminal {
    pub fn builder() -> builder::DesiredTerminal {
        Default::default()
    }
}
#[doc = "`DesiredWorker`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"id\","]
#[doc = "    \"kind\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"config\": {},"]
#[doc = "    \"id\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"kind\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DesiredWorker {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub config: ::std::option::Option<::serde_json::Value>,
    pub id: ::std::string::String,
    pub kind: ::std::string::String,
}
impl DesiredWorker {
    pub fn builder() -> builder::DesiredWorker {
        Default::default()
    }
}
#[doc = "`DiagnosticCursorV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 16384,"]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct DiagnosticCursorV1(::std::string::String);
impl ::std::ops::Deref for DiagnosticCursorV1 {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<DiagnosticCursorV1> for ::std::string::String {
    fn from(value: DiagnosticCursorV1) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for DiagnosticCursorV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for DiagnosticCursorV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for DiagnosticCursorV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for DiagnosticCursorV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for DiagnosticCursorV1 {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "vibefield.diagnostics.delta.contract.v1"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"description\": \"vibefield.diagnostics.delta.contract.v1\","]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"cursor\","]
#[doc = "    \"droppedSincePrevious\","]
#[doc = "    \"records\","]
#[doc = "    \"v\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"cursor\": {"]
#[doc = "      \"$ref\": \"#/definitions/DiagnosticCursorV1\""]
#[doc = "    },"]
#[doc = "    \"droppedSincePrevious\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"records\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/LogRecordV1\""]
#[doc = "      },"]
#[doc = "      \"maxItems\": 2000"]
#[doc = "    },"]
#[doc = "    \"transportTruncatedRecords\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"v\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSchemaVersionV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DiagnosticLogDeltaV1 {
    pub cursor: DiagnosticCursorV1,
    #[serde(rename = "droppedSincePrevious")]
    pub dropped_since_previous: LogSafeIntegerV1,
    pub records: ::std::vec::Vec<LogRecordV1>,
    #[serde(
        rename = "transportTruncatedRecords",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub transport_truncated_records: ::std::option::Option<LogSafeIntegerV1>,
    pub v: LogSchemaVersionV1,
}
impl DiagnosticLogDeltaV1 {
    pub fn builder() -> builder::DiagnosticLogDeltaV1 {
        Default::default()
    }
}
#[doc = "vibefield.diagnostics.contract.v1"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"description\": \"vibefield.diagnostics.contract.v1\","]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"droppedBefore\","]
#[doc = "    \"nextCursor\","]
#[doc = "    \"producers\","]
#[doc = "    \"records\","]
#[doc = "    \"v\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"droppedBefore\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"history\": {"]
#[doc = "      \"type\": \"object\","]
#[doc = "      \"required\": ["]
#[doc = "        \"parseFailures\","]
#[doc = "        \"scannedBytes\","]
#[doc = "        \"scannedSegments\","]
#[doc = "        \"skippedUnsafeSegments\","]
#[doc = "        \"truncated\""]
#[doc = "      ],"]
#[doc = "      \"properties\": {"]
#[doc = "        \"parseFailures\": {"]
#[doc = "          \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "        },"]
#[doc = "        \"scannedBytes\": {"]
#[doc = "          \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "        },"]
#[doc = "        \"scannedSegments\": {"]
#[doc = "          \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "        },"]
#[doc = "        \"skippedUnsafeSegments\": {"]
#[doc = "          \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "        },"]
#[doc = "        \"truncated\": {"]
#[doc = "          \"type\": \"boolean\""]
#[doc = "        }"]
#[doc = "      },"]
#[doc = "      \"additionalProperties\": true"]
#[doc = "    },"]
#[doc = "    \"nextCursor\": {"]
#[doc = "      \"$ref\": \"#/definitions/DiagnosticCursorV1\""]
#[doc = "    },"]
#[doc = "    \"producers\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/DiagnosticProducerStateV1\""]
#[doc = "      },"]
#[doc = "      \"maxItems\": 16"]
#[doc = "    },"]
#[doc = "    \"records\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/LogRecordV1\""]
#[doc = "      },"]
#[doc = "      \"maxItems\": 2000"]
#[doc = "    },"]
#[doc = "    \"transportTruncatedRecords\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"v\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSchemaVersionV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DiagnosticLogSnapshotV1 {
    #[serde(rename = "droppedBefore")]
    pub dropped_before: LogSafeIntegerV1,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub history: ::std::option::Option<DiagnosticLogSnapshotV1History>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: DiagnosticCursorV1,
    pub producers: ::std::vec::Vec<DiagnosticProducerStateV1>,
    pub records: ::std::vec::Vec<LogRecordV1>,
    #[serde(
        rename = "transportTruncatedRecords",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub transport_truncated_records: ::std::option::Option<LogSafeIntegerV1>,
    pub v: LogSchemaVersionV1,
}
impl DiagnosticLogSnapshotV1 {
    pub fn builder() -> builder::DiagnosticLogSnapshotV1 {
        Default::default()
    }
}
#[doc = "`DiagnosticLogSnapshotV1History`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"parseFailures\","]
#[doc = "    \"scannedBytes\","]
#[doc = "    \"scannedSegments\","]
#[doc = "    \"skippedUnsafeSegments\","]
#[doc = "    \"truncated\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"parseFailures\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"scannedBytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"scannedSegments\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"skippedUnsafeSegments\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"truncated\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DiagnosticLogSnapshotV1History {
    #[serde(rename = "parseFailures")]
    pub parse_failures: LogSafeIntegerV1,
    #[serde(rename = "scannedBytes")]
    pub scanned_bytes: LogSafeIntegerV1,
    #[serde(rename = "scannedSegments")]
    pub scanned_segments: LogSafeIntegerV1,
    #[serde(rename = "skippedUnsafeSegments")]
    pub skipped_unsafe_segments: LogSafeIntegerV1,
    pub truncated: bool,
}
impl DiagnosticLogSnapshotV1History {
    pub fn builder() -> builder::DiagnosticLogSnapshotV1History {
        Default::default()
    }
}
#[doc = "`DiagnosticProducerStateV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"bootId\","]
#[doc = "    \"droppedBefore\","]
#[doc = "    \"health\","]
#[doc = "    \"instanceId\","]
#[doc = "    \"newestCursor\","]
#[doc = "    \"oldestCursor\","]
#[doc = "    \"producerId\","]
#[doc = "    \"service\","]
#[doc = "    \"stream\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"bootId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"droppedBefore\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"health\": {"]
#[doc = "      \"$ref\": \"#/definitions/LoggingHealthV1\""]
#[doc = "    },"]
#[doc = "    \"instanceId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"newestCursor\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"oldestCursor\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"producerId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"service\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogServiceV1\""]
#[doc = "    },"]
#[doc = "    \"stream\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogStreamV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct DiagnosticProducerStateV1 {
    #[serde(rename = "bootId")]
    pub boot_id: LogBoundedIdentityV1,
    #[serde(rename = "droppedBefore")]
    pub dropped_before: LogSafeIntegerV1,
    pub health: LoggingHealthV1,
    #[serde(rename = "instanceId")]
    pub instance_id: LogBoundedIdentityV1,
    #[serde(rename = "newestCursor")]
    pub newest_cursor: LogSafeIntegerV1,
    #[serde(rename = "oldestCursor")]
    pub oldest_cursor: LogSafeIntegerV1,
    #[serde(rename = "producerId")]
    pub producer_id: LogBoundedIdentityV1,
    pub service: LogServiceV1,
    pub stream: LogStreamV1,
}
impl DiagnosticProducerStateV1 {
    pub fn builder() -> builder::DiagnosticProducerStateV1 {
        Default::default()
    }
}
#[doc = "`ErrorData`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"kind\","]
#[doc = "    \"retryable\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"details\": {},"]
#[doc = "    \"kind\": {"]
#[doc = "      \"$ref\": \"#/definitions/ErrorKind\""]
#[doc = "    },"]
#[doc = "    \"retryable\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ErrorData {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub details: ::std::option::Option<::serde_json::Value>,
    pub kind: ErrorKind,
    pub retryable: bool,
}
impl ErrorData {
    pub fn builder() -> builder::ErrorData {
        Default::default()
    }
}
#[doc = "`ErrorKind`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"UNAUTHORIZED\","]
#[doc = "    \"FORBIDDEN_SCOPE\","]
#[doc = "    \"NOT_FOUND\","]
#[doc = "    \"CONFLICT\","]
#[doc = "    \"PRECONDITION_FAILED\","]
#[doc = "    \"UNAVAILABLE\","]
#[doc = "    \"AUDIT_UNAVAILABLE\","]
#[doc = "    \"TIMEOUT\","]
#[doc = "    \"INCOMPATIBLE\","]
#[doc = "    \"RESOURCE_EXHAUSTED\","]
#[doc = "    \"INTERNAL\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ErrorKind {
    #[serde(rename = "UNAUTHORIZED")]
    Unauthorized,
    #[serde(rename = "FORBIDDEN_SCOPE")]
    ForbiddenScope,
    #[serde(rename = "NOT_FOUND")]
    NotFound,
    #[serde(rename = "CONFLICT")]
    Conflict,
    #[serde(rename = "PRECONDITION_FAILED")]
    PreconditionFailed,
    #[serde(rename = "UNAVAILABLE")]
    Unavailable,
    #[serde(rename = "AUDIT_UNAVAILABLE")]
    AuditUnavailable,
    #[serde(rename = "TIMEOUT")]
    Timeout,
    #[serde(rename = "INCOMPATIBLE")]
    Incompatible,
    #[serde(rename = "RESOURCE_EXHAUSTED")]
    ResourceExhausted,
    #[serde(rename = "INTERNAL")]
    Internal,
}
impl ::std::fmt::Display for ErrorKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Unauthorized => f.write_str("UNAUTHORIZED"),
            Self::ForbiddenScope => f.write_str("FORBIDDEN_SCOPE"),
            Self::NotFound => f.write_str("NOT_FOUND"),
            Self::Conflict => f.write_str("CONFLICT"),
            Self::PreconditionFailed => f.write_str("PRECONDITION_FAILED"),
            Self::Unavailable => f.write_str("UNAVAILABLE"),
            Self::AuditUnavailable => f.write_str("AUDIT_UNAVAILABLE"),
            Self::Timeout => f.write_str("TIMEOUT"),
            Self::Incompatible => f.write_str("INCOMPATIBLE"),
            Self::ResourceExhausted => f.write_str("RESOURCE_EXHAUSTED"),
            Self::Internal => f.write_str("INTERNAL"),
        }
    }
}
impl ::std::str::FromStr for ErrorKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "UNAUTHORIZED" => Ok(Self::Unauthorized),
            "FORBIDDEN_SCOPE" => Ok(Self::ForbiddenScope),
            "NOT_FOUND" => Ok(Self::NotFound),
            "CONFLICT" => Ok(Self::Conflict),
            "PRECONDITION_FAILED" => Ok(Self::PreconditionFailed),
            "UNAVAILABLE" => Ok(Self::Unavailable),
            "AUDIT_UNAVAILABLE" => Ok(Self::AuditUnavailable),
            "TIMEOUT" => Ok(Self::Timeout),
            "INCOMPATIBLE" => Ok(Self::Incompatible),
            "RESOURCE_EXHAUSTED" => Ok(Self::ResourceExhausted),
            "INTERNAL" => Ok(Self::Internal),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ErrorKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ErrorKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ErrorKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`Hello`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"clientKind\","]
#[doc = "    \"contractsVersion\","]
#[doc = "    \"minCompatible\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"clientKind\": {"]
#[doc = "      \"$ref\": \"#/definitions/ClientKind\""]
#[doc = "    },"]
#[doc = "    \"contractsVersion\": {"]
#[doc = "      \"$ref\": \"#/definitions/SemverString\""]
#[doc = "    },"]
#[doc = "    \"credential\": {"]
#[doc = "      \"anyOf\": ["]
#[doc = "        {"]
#[doc = "          \"type\": \"string\""]
#[doc = "        },"]
#[doc = "        {"]
#[doc = "          \"$ref\": \"#/definitions/PairingMac\""]
#[doc = "        }"]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"deviceId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"minCompatible\": {"]
#[doc = "      \"$ref\": \"#/definitions/SemverString\""]
#[doc = "    },"]
#[doc = "    \"userId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct Hello {
    #[serde(rename = "clientKind")]
    pub client_kind: ClientKind,
    #[serde(rename = "contractsVersion")]
    pub contracts_version: SemverString,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub credential: ::std::option::Option<HelloCredential>,
    #[serde(
        rename = "deviceId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub device_id: ::std::option::Option<::std::string::String>,
    #[serde(rename = "minCompatible")]
    pub min_compatible: SemverString,
    #[serde(
        rename = "userId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub user_id: ::std::option::Option<::std::string::String>,
}
impl Hello {
    pub fn builder() -> builder::Hello {
        Default::default()
    }
}
#[doc = "`HelloAck`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"contractsVersion\","]
#[doc = "    \"grantedScopes\","]
#[doc = "    \"serverKind\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"contractsVersion\": {"]
#[doc = "      \"$ref\": \"#/definitions/SemverString\""]
#[doc = "    },"]
#[doc = "    \"grantedScopes\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"type\": \"string\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"nativeBuild\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"serverKind\": {"]
#[doc = "      \"$ref\": \"#/definitions/ServerKind\""]
#[doc = "    },"]
#[doc = "    \"serverMac\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"terminal\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalEndpoints\""]
#[doc = "    },"]
#[doc = "    \"terminalRoutes\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalRouteSnapshot\""]
#[doc = "    },"]
#[doc = "    \"userId\": {"]
#[doc = "      \"type\": ["]
#[doc = "        \"string\","]
#[doc = "        \"null\""]
#[doc = "      ]"]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct HelloAck {
    #[serde(rename = "contractsVersion")]
    pub contracts_version: SemverString,
    #[serde(rename = "grantedScopes")]
    pub granted_scopes: ::std::vec::Vec<::std::string::String>,
    #[serde(
        rename = "nativeBuild",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub native_build: ::std::option::Option<::std::string::String>,
    #[serde(rename = "serverKind")]
    pub server_kind: ServerKind,
    #[serde(
        rename = "serverMac",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub server_mac: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub terminal: ::std::option::Option<TerminalEndpoints>,
    #[serde(
        rename = "terminalRoutes",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub terminal_routes: ::std::option::Option<TerminalRouteSnapshot>,
    #[serde(
        rename = "userId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub user_id: ::std::option::Option<::std::string::String>,
}
impl HelloAck {
    pub fn builder() -> builder::HelloAck {
        Default::default()
    }
}
#[doc = "`HelloCredential`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"anyOf\": ["]
#[doc = "    {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    {"]
#[doc = "      \"$ref\": \"#/definitions/PairingMac\""]
#[doc = "    }"]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum HelloCredential {
    String(::std::string::String),
    PairingMac(PairingMac),
}
impl ::std::convert::From<PairingMac> for HelloCredential {
    fn from(value: PairingMac) -> Self {
        Self::PairingMac(value)
    }
}
#[doc = "`LogAttributesV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"additionalProperties\": {"]
#[doc = "    \"$ref\": \"#/definitions/LogValueV1\""]
#[doc = "  }"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct LogAttributesV1(pub ::std::collections::HashMap<::std::string::String, LogValueV1>);
impl ::std::ops::Deref for LogAttributesV1 {
    type Target = ::std::collections::HashMap<::std::string::String, LogValueV1>;
    fn deref(&self) -> &::std::collections::HashMap<::std::string::String, LogValueV1> {
        &self.0
    }
}
impl ::std::convert::From<LogAttributesV1>
    for ::std::collections::HashMap<::std::string::String, LogValueV1>
{
    fn from(value: LogAttributesV1) -> Self {
        value.0
    }
}
impl ::std::convert::From<::std::collections::HashMap<::std::string::String, LogValueV1>>
    for LogAttributesV1
{
    fn from(value: ::std::collections::HashMap<::std::string::String, LogValueV1>) -> Self {
        Self(value)
    }
}
#[doc = "`LogBoundedIdentityV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 256,"]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogBoundedIdentityV1(::std::string::String);
impl ::std::ops::Deref for LogBoundedIdentityV1 {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogBoundedIdentityV1> for ::std::string::String {
    fn from(value: LogBoundedIdentityV1) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogBoundedIdentityV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogBoundedIdentityV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogBoundedIdentityV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogBoundedIdentityV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogBoundedIdentityV1 {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogErrorV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"message\","]
#[doc = "    \"type\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"causes\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/LogErrorV1\""]
#[doc = "      },"]
#[doc = "      \"maxItems\": 4"]
#[doc = "    },"]
#[doc = "    \"code\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 256"]
#[doc = "    },"]
#[doc = "    \"message\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 16384"]
#[doc = "    },"]
#[doc = "    \"stack\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 32768"]
#[doc = "    },"]
#[doc = "    \"type\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 256,"]
#[doc = "      \"minLength\": 1"]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LogErrorV1 {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub causes: ::std::vec::Vec<LogErrorV1>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub code: ::std::option::Option<LogErrorV1Code>,
    pub message: LogErrorV1Message,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub stack: ::std::option::Option<LogErrorV1Stack>,
    #[serde(rename = "type")]
    pub type_: LogErrorV1Type,
}
impl LogErrorV1 {
    pub fn builder() -> builder::LogErrorV1 {
        Default::default()
    }
}
#[doc = "`LogErrorV1Code`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 256"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogErrorV1Code(::std::string::String);
impl ::std::ops::Deref for LogErrorV1Code {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogErrorV1Code> for ::std::string::String {
    fn from(value: LogErrorV1Code) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogErrorV1Code {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogErrorV1Code {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogErrorV1Code {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogErrorV1Code {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogErrorV1Code {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogErrorV1Message`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 16384"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogErrorV1Message(::std::string::String);
impl ::std::ops::Deref for LogErrorV1Message {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogErrorV1Message> for ::std::string::String {
    fn from(value: LogErrorV1Message) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogErrorV1Message {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogErrorV1Message {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogErrorV1Message {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogErrorV1Message {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogErrorV1Message {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogErrorV1Stack`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 32768"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogErrorV1Stack(::std::string::String);
impl ::std::ops::Deref for LogErrorV1Stack {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogErrorV1Stack> for ::std::string::String {
    fn from(value: LogErrorV1Stack) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogErrorV1Stack {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 32768usize {
            return Err("longer than 32768 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogErrorV1Stack {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogErrorV1Stack {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogErrorV1Stack {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogErrorV1Stack {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogErrorV1Type`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 256,"]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogErrorV1Type(::std::string::String);
impl ::std::ops::Deref for LogErrorV1Type {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogErrorV1Type> for ::std::string::String {
    fn from(value: LogErrorV1Type) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogErrorV1Type {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 256usize {
            return Err("longer than 256 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogErrorV1Type {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogErrorV1Type {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogErrorV1Type {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogErrorV1Type {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogLevelNameV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"trace\","]
#[doc = "    \"debug\","]
#[doc = "    \"info\","]
#[doc = "    \"warn\","]
#[doc = "    \"error\","]
#[doc = "    \"fatal\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LogLevelNameV1 {
    #[serde(rename = "trace")]
    Trace,
    #[serde(rename = "debug")]
    Debug,
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warn")]
    Warn,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "fatal")]
    Fatal,
}
impl ::std::fmt::Display for LogLevelNameV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Trace => f.write_str("trace"),
            Self::Debug => f.write_str("debug"),
            Self::Info => f.write_str("info"),
            Self::Warn => f.write_str("warn"),
            Self::Error => f.write_str("error"),
            Self::Fatal => f.write_str("fatal"),
        }
    }
}
impl ::std::str::FromStr for LogLevelNameV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "trace" => Ok(Self::Trace),
            "debug" => Ok(Self::Debug),
            "info" => Ok(Self::Info),
            "warn" => Ok(Self::Warn),
            "error" => Ok(Self::Error),
            "fatal" => Ok(Self::Fatal),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LogLevelNameV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogLevelNameV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogLevelNameV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LogLevelV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"integer\","]
#[doc = "  \"enum\": ["]
#[doc = "    10,"]
#[doc = "    20,"]
#[doc = "    30,"]
#[doc = "    40,"]
#[doc = "    50,"]
#[doc = "    60"]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct LogLevelV1(i64);
impl ::std::ops::Deref for LogLevelV1 {
    type Target = i64;
    fn deref(&self) -> &i64 {
        &self.0
    }
}
impl ::std::convert::From<LogLevelV1> for i64 {
    fn from(value: LogLevelV1) -> Self {
        value.0
    }
}
impl ::std::convert::TryFrom<i64> for LogLevelV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: i64) -> ::std::result::Result<Self, self::error::ConversionError> {
        if ![10_i64, 20_i64, 30_i64, 40_i64, 50_i64, 60_i64].contains(&value) {
            Err("invalid value".into())
        } else {
            Ok(Self(value))
        }
    }
}
impl<'de> ::serde::Deserialize<'de> for LogLevelV1 {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        Self::try_from(<i64>::deserialize(deserializer)?)
            .map_err(|e| <D::Error as ::serde::de::Error>::custom(e.to_string()))
    }
}
#[doc = "vibefield.logging.contract.v1"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"description\": \"vibefield.logging.contract.v1\","]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"bootId\","]
#[doc = "    \"component\","]
#[doc = "    \"event\","]
#[doc = "    \"instanceId\","]
#[doc = "    \"level\","]
#[doc = "    \"msg\","]
#[doc = "    \"pid\","]
#[doc = "    \"role\","]
#[doc = "    \"seq\","]
#[doc = "    \"service\","]
#[doc = "    \"severity\","]
#[doc = "    \"time\","]
#[doc = "    \"v\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"attrs\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogAttributesV1\""]
#[doc = "    },"]
#[doc = "    \"bootId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"component\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 160,"]
#[doc = "      \"minLength\": 1,"]
#[doc = "      \"pattern\": \"^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$\""]
#[doc = "    },"]
#[doc = "    \"deviceId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"docId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"err\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogErrorV1\""]
#[doc = "    },"]
#[doc = "    \"event\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 192,"]
#[doc = "      \"minLength\": 3,"]
#[doc = "      \"pattern\": \"^[a-z][a-z0-9_]*(?:\\\\.[a-z][a-z0-9_]*)+$\""]
#[doc = "    },"]
#[doc = "    \"instanceId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"level\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogLevelV1\""]
#[doc = "    },"]
#[doc = "    \"msg\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 16384"]
#[doc = "    },"]
#[doc = "    \"observedTime\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"operationId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"pid\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"plugin\": {"]
#[doc = "      \"$ref\": \"#/definitions/PluginLogProvenanceV1\""]
#[doc = "    },"]
#[doc = "    \"requestId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"role\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogRoleV1\""]
#[doc = "    },"]
#[doc = "    \"seq\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"service\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogServiceV1\""]
#[doc = "    },"]
#[doc = "    \"sessionId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"severity\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSeverityV1\""]
#[doc = "    },"]
#[doc = "    \"spanId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"time\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"traceId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"truncation\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogTruncationV1\""]
#[doc = "    },"]
#[doc = "    \"v\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSchemaVersionV1\""]
#[doc = "    },"]
#[doc = "    \"windowId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LogRecordV1 {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub attrs: ::std::option::Option<LogAttributesV1>,
    #[serde(rename = "bootId")]
    pub boot_id: LogBoundedIdentityV1,
    pub component: LogRecordV1Component,
    #[serde(
        rename = "deviceId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub device_id: ::std::option::Option<LogBoundedIdentityV1>,
    #[serde(
        rename = "docId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub doc_id: ::std::option::Option<LogBoundedIdentityV1>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub err: ::std::option::Option<LogErrorV1>,
    pub event: LogRecordV1Event,
    #[serde(rename = "instanceId")]
    pub instance_id: LogBoundedIdentityV1,
    pub level: LogLevelV1,
    pub msg: LogRecordV1Msg,
    #[serde(
        rename = "observedTime",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub observed_time: ::std::option::Option<LogSafeIntegerV1>,
    #[serde(
        rename = "operationId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub operation_id: ::std::option::Option<LogBoundedIdentityV1>,
    pub pid: LogSafeIntegerV1,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub plugin: ::std::option::Option<PluginLogProvenanceV1>,
    #[serde(
        rename = "requestId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub request_id: ::std::option::Option<LogBoundedIdentityV1>,
    pub role: LogRoleV1,
    pub seq: LogSafeIntegerV1,
    pub service: LogServiceV1,
    #[serde(
        rename = "sessionId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub session_id: ::std::option::Option<LogBoundedIdentityV1>,
    pub severity: LogSeverityV1,
    #[serde(
        rename = "spanId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub span_id: ::std::option::Option<LogBoundedIdentityV1>,
    pub time: LogSafeIntegerV1,
    #[serde(
        rename = "traceId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub trace_id: ::std::option::Option<LogBoundedIdentityV1>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub truncation: ::std::option::Option<LogTruncationV1>,
    pub v: LogSchemaVersionV1,
    #[serde(
        rename = "windowId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub window_id: ::std::option::Option<LogBoundedIdentityV1>,
}
impl LogRecordV1 {
    pub fn builder() -> builder::LogRecordV1 {
        Default::default()
    }
}
#[doc = "`LogRecordV1Component`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 160,"]
#[doc = "  \"minLength\": 1,"]
#[doc = "  \"pattern\": \"^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$\""]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogRecordV1Component(::std::string::String);
impl ::std::ops::Deref for LogRecordV1Component {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogRecordV1Component> for ::std::string::String {
    fn from(value: LogRecordV1Component) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogRecordV1Component {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 160usize {
            return Err("longer than 160 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err(
                "doesn't match pattern \"^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)*$\"".into(),
            );
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogRecordV1Component {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogRecordV1Component {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogRecordV1Component {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogRecordV1Component {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogRecordV1Event`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 192,"]
#[doc = "  \"minLength\": 3,"]
#[doc = "  \"pattern\": \"^[a-z][a-z0-9_]*(?:\\\\.[a-z][a-z0-9_]*)+$\""]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogRecordV1Event(::std::string::String);
impl ::std::ops::Deref for LogRecordV1Event {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogRecordV1Event> for ::std::string::String {
    fn from(value: LogRecordV1Event) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogRecordV1Event {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 192usize {
            return Err("longer than 192 characters".into());
        }
        if value.chars().count() < 3usize {
            return Err("shorter than 3 characters".into());
        }
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err(
                "doesn't match pattern \"^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$\"".into(),
            );
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogRecordV1Event {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogRecordV1Event {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogRecordV1Event {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogRecordV1Event {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogRecordV1Msg`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 16384"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogRecordV1Msg(::std::string::String);
impl ::std::ops::Deref for LogRecordV1Msg {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogRecordV1Msg> for ::std::string::String {
    fn from(value: LogRecordV1Msg) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogRecordV1Msg {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 16384usize {
            return Err("longer than 16384 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogRecordV1Msg {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogRecordV1Msg {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogRecordV1Msg {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogRecordV1Msg {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogRoleV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"main\","]
#[doc = "    \"renderer\","]
#[doc = "    \"utility\","]
#[doc = "    \"daemon\","]
#[doc = "    \"worker\","]
#[doc = "    \"sidecar\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LogRoleV1 {
    #[serde(rename = "main")]
    Main,
    #[serde(rename = "renderer")]
    Renderer,
    #[serde(rename = "utility")]
    Utility,
    #[serde(rename = "daemon")]
    Daemon,
    #[serde(rename = "worker")]
    Worker,
    #[serde(rename = "sidecar")]
    Sidecar,
}
impl ::std::fmt::Display for LogRoleV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Main => f.write_str("main"),
            Self::Renderer => f.write_str("renderer"),
            Self::Utility => f.write_str("utility"),
            Self::Daemon => f.write_str("daemon"),
            Self::Worker => f.write_str("worker"),
            Self::Sidecar => f.write_str("sidecar"),
        }
    }
}
impl ::std::str::FromStr for LogRoleV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "main" => Ok(Self::Main),
            "renderer" => Ok(Self::Renderer),
            "utility" => Ok(Self::Utility),
            "daemon" => Ok(Self::Daemon),
            "worker" => Ok(Self::Worker),
            "sidecar" => Ok(Self::Sidecar),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LogRoleV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogRoleV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogRoleV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LogSafeIntegerV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"integer\","]
#[doc = "  \"maximum\": 9007199254740991.0,"]
#[doc = "  \"minimum\": 0.0"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct LogSafeIntegerV1(pub i64);
impl ::std::ops::Deref for LogSafeIntegerV1 {
    type Target = i64;
    fn deref(&self) -> &i64 {
        &self.0
    }
}
impl ::std::convert::From<LogSafeIntegerV1> for i64 {
    fn from(value: LogSafeIntegerV1) -> Self {
        value.0
    }
}
impl ::std::convert::From<i64> for LogSafeIntegerV1 {
    fn from(value: i64) -> Self {
        Self(value)
    }
}
impl ::std::str::FromStr for LogSafeIntegerV1 {
    type Err = <i64 as ::std::str::FromStr>::Err;
    fn from_str(value: &str) -> ::std::result::Result<Self, Self::Err> {
        Ok(Self(value.parse()?))
    }
}
impl ::std::convert::TryFrom<&str> for LogSafeIntegerV1 {
    type Error = <i64 as ::std::str::FromStr>::Err;
    fn try_from(value: &str) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<String> for LogSafeIntegerV1 {
    type Error = <i64 as ::std::str::FromStr>::Err;
    fn try_from(value: String) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::fmt::Display for LogSafeIntegerV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        self.0.fmt(f)
    }
}
#[doc = "`LogSchemaVersionV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"integer\","]
#[doc = "  \"maximum\": 1.0,"]
#[doc = "  \"minimum\": 1.0"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct LogSchemaVersionV1(pub ::std::num::NonZeroU64);
impl ::std::ops::Deref for LogSchemaVersionV1 {
    type Target = ::std::num::NonZeroU64;
    fn deref(&self) -> &::std::num::NonZeroU64 {
        &self.0
    }
}
impl ::std::convert::From<LogSchemaVersionV1> for ::std::num::NonZeroU64 {
    fn from(value: LogSchemaVersionV1) -> Self {
        value.0
    }
}
impl ::std::convert::From<::std::num::NonZeroU64> for LogSchemaVersionV1 {
    fn from(value: ::std::num::NonZeroU64) -> Self {
        Self(value)
    }
}
impl ::std::str::FromStr for LogSchemaVersionV1 {
    type Err = <::std::num::NonZeroU64 as ::std::str::FromStr>::Err;
    fn from_str(value: &str) -> ::std::result::Result<Self, Self::Err> {
        Ok(Self(value.parse()?))
    }
}
impl ::std::convert::TryFrom<&str> for LogSchemaVersionV1 {
    type Error = <::std::num::NonZeroU64 as ::std::str::FromStr>::Err;
    fn try_from(value: &str) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<String> for LogSchemaVersionV1 {
    type Error = <::std::num::NonZeroU64 as ::std::str::FromStr>::Err;
    fn try_from(value: String) -> ::std::result::Result<Self, Self::Error> {
        value.parse()
    }
}
impl ::std::fmt::Display for LogSchemaVersionV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        self.0.fmt(f)
    }
}
#[doc = "`LogServiceV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"desktop\","]
#[doc = "    \"renderer\","]
#[doc = "    \"utility\","]
#[doc = "    \"fieldd\","]
#[doc = "    \"field-native\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LogServiceV1 {
    #[serde(rename = "desktop")]
    Desktop,
    #[serde(rename = "renderer")]
    Renderer,
    #[serde(rename = "utility")]
    Utility,
    #[serde(rename = "fieldd")]
    Fieldd,
    #[serde(rename = "field-native")]
    FieldNative,
}
impl ::std::fmt::Display for LogServiceV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Desktop => f.write_str("desktop"),
            Self::Renderer => f.write_str("renderer"),
            Self::Utility => f.write_str("utility"),
            Self::Fieldd => f.write_str("fieldd"),
            Self::FieldNative => f.write_str("field-native"),
        }
    }
}
impl ::std::str::FromStr for LogServiceV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "desktop" => Ok(Self::Desktop),
            "renderer" => Ok(Self::Renderer),
            "utility" => Ok(Self::Utility),
            "fieldd" => Ok(Self::Fieldd),
            "field-native" => Ok(Self::FieldNative),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LogServiceV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogServiceV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogServiceV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LogSeverityV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"TRACE\","]
#[doc = "    \"DEBUG\","]
#[doc = "    \"INFO\","]
#[doc = "    \"WARN\","]
#[doc = "    \"ERROR\","]
#[doc = "    \"FATAL\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LogSeverityV1 {
    #[serde(rename = "TRACE")]
    Trace,
    #[serde(rename = "DEBUG")]
    Debug,
    #[serde(rename = "INFO")]
    Info,
    #[serde(rename = "WARN")]
    Warn,
    #[serde(rename = "ERROR")]
    Error,
    #[serde(rename = "FATAL")]
    Fatal,
}
impl ::std::fmt::Display for LogSeverityV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Trace => f.write_str("TRACE"),
            Self::Debug => f.write_str("DEBUG"),
            Self::Info => f.write_str("INFO"),
            Self::Warn => f.write_str("WARN"),
            Self::Error => f.write_str("ERROR"),
            Self::Fatal => f.write_str("FATAL"),
        }
    }
}
impl ::std::str::FromStr for LogSeverityV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "TRACE" => Ok(Self::Trace),
            "DEBUG" => Ok(Self::Debug),
            "INFO" => Ok(Self::Info),
            "WARN" => Ok(Self::Warn),
            "ERROR" => Ok(Self::Error),
            "FATAL" => Ok(Self::Fatal),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LogSeverityV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogSeverityV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogSeverityV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LogStreamV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"system/desktop\","]
#[doc = "    \"system/renderer\","]
#[doc = "    \"system/utility\","]
#[doc = "    \"system/fieldd\","]
#[doc = "    \"system/field-native\","]
#[doc = "    \"plugins/renderer\","]
#[doc = "    \"plugins/service\","]
#[doc = "    \"plugins/utility\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LogStreamV1 {
    #[serde(rename = "system/desktop")]
    SystemDesktop,
    #[serde(rename = "system/renderer")]
    SystemRenderer,
    #[serde(rename = "system/utility")]
    SystemUtility,
    #[serde(rename = "system/fieldd")]
    SystemFieldd,
    #[serde(rename = "system/field-native")]
    SystemFieldNative,
    #[serde(rename = "plugins/renderer")]
    PluginsRenderer,
    #[serde(rename = "plugins/service")]
    PluginsService,
    #[serde(rename = "plugins/utility")]
    PluginsUtility,
}
impl ::std::fmt::Display for LogStreamV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::SystemDesktop => f.write_str("system/desktop"),
            Self::SystemRenderer => f.write_str("system/renderer"),
            Self::SystemUtility => f.write_str("system/utility"),
            Self::SystemFieldd => f.write_str("system/fieldd"),
            Self::SystemFieldNative => f.write_str("system/field-native"),
            Self::PluginsRenderer => f.write_str("plugins/renderer"),
            Self::PluginsService => f.write_str("plugins/service"),
            Self::PluginsUtility => f.write_str("plugins/utility"),
        }
    }
}
impl ::std::str::FromStr for LogStreamV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "system/desktop" => Ok(Self::SystemDesktop),
            "system/renderer" => Ok(Self::SystemRenderer),
            "system/utility" => Ok(Self::SystemUtility),
            "system/fieldd" => Ok(Self::SystemFieldd),
            "system/field-native" => Ok(Self::SystemFieldNative),
            "plugins/renderer" => Ok(Self::PluginsRenderer),
            "plugins/service" => Ok(Self::PluginsService),
            "plugins/utility" => Ok(Self::PluginsUtility),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LogStreamV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogStreamV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogStreamV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LogTruncationReasonV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"record-bytes\","]
#[doc = "    \"message-bytes\","]
#[doc = "    \"string-bytes\","]
#[doc = "    \"object-depth\","]
#[doc = "    \"object-keys\","]
#[doc = "    \"array-items\","]
#[doc = "    \"error-causes\","]
#[doc = "    \"partial-line\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LogTruncationReasonV1 {
    #[serde(rename = "record-bytes")]
    RecordBytes,
    #[serde(rename = "message-bytes")]
    MessageBytes,
    #[serde(rename = "string-bytes")]
    StringBytes,
    #[serde(rename = "object-depth")]
    ObjectDepth,
    #[serde(rename = "object-keys")]
    ObjectKeys,
    #[serde(rename = "array-items")]
    ArrayItems,
    #[serde(rename = "error-causes")]
    ErrorCauses,
    #[serde(rename = "partial-line")]
    PartialLine,
}
impl ::std::fmt::Display for LogTruncationReasonV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::RecordBytes => f.write_str("record-bytes"),
            Self::MessageBytes => f.write_str("message-bytes"),
            Self::StringBytes => f.write_str("string-bytes"),
            Self::ObjectDepth => f.write_str("object-depth"),
            Self::ObjectKeys => f.write_str("object-keys"),
            Self::ArrayItems => f.write_str("array-items"),
            Self::ErrorCauses => f.write_str("error-causes"),
            Self::PartialLine => f.write_str("partial-line"),
        }
    }
}
impl ::std::str::FromStr for LogTruncationReasonV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "record-bytes" => Ok(Self::RecordBytes),
            "message-bytes" => Ok(Self::MessageBytes),
            "string-bytes" => Ok(Self::StringBytes),
            "object-depth" => Ok(Self::ObjectDepth),
            "object-keys" => Ok(Self::ObjectKeys),
            "array-items" => Ok(Self::ArrayItems),
            "error-causes" => Ok(Self::ErrorCauses),
            "partial-line" => Ok(Self::PartialLine),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LogTruncationReasonV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogTruncationReasonV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogTruncationReasonV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LogTruncationV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"reasons\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"droppedBytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"droppedItems\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"fields\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"type\": \"string\","]
#[doc = "        \"maxLength\": 160,"]
#[doc = "        \"minLength\": 1"]
#[doc = "      },"]
#[doc = "      \"maxItems\": 32"]
#[doc = "    },"]
#[doc = "    \"originalBytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"originalItems\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"reasons\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/LogTruncationReasonV1\""]
#[doc = "      },"]
#[doc = "      \"maxItems\": 8,"]
#[doc = "      \"minItems\": 1"]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LogTruncationV1 {
    #[serde(
        rename = "droppedBytes",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub dropped_bytes: ::std::option::Option<LogSafeIntegerV1>,
    #[serde(
        rename = "droppedItems",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub dropped_items: ::std::option::Option<LogSafeIntegerV1>,
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub fields: ::std::vec::Vec<LogTruncationV1FieldsItem>,
    #[serde(
        rename = "originalBytes",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub original_bytes: ::std::option::Option<LogSafeIntegerV1>,
    #[serde(
        rename = "originalItems",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub original_items: ::std::option::Option<LogSafeIntegerV1>,
    pub reasons: ::std::vec::Vec<LogTruncationReasonV1>,
}
impl LogTruncationV1 {
    pub fn builder() -> builder::LogTruncationV1 {
        Default::default()
    }
}
#[doc = "`LogTruncationV1FieldsItem`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 160,"]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LogTruncationV1FieldsItem(::std::string::String);
impl ::std::ops::Deref for LogTruncationV1FieldsItem {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LogTruncationV1FieldsItem> for ::std::string::String {
    fn from(value: LogTruncationV1FieldsItem) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LogTruncationV1FieldsItem {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 160usize {
            return Err("longer than 160 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LogTruncationV1FieldsItem {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LogTruncationV1FieldsItem {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LogTruncationV1FieldsItem {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LogTruncationV1FieldsItem {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`LogValueV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct LogValueV1(pub ::serde_json::Value);
impl ::std::ops::Deref for LogValueV1 {
    type Target = ::serde_json::Value;
    fn deref(&self) -> &::serde_json::Value {
        &self.0
    }
}
impl ::std::convert::From<LogValueV1> for ::serde_json::Value {
    fn from(value: LogValueV1) -> Self {
        value.0
    }
}
impl ::std::convert::From<::serde_json::Value> for LogValueV1 {
    fn from(value: ::serde_json::Value) -> Self {
        Self(value)
    }
}
#[doc = "`LoggingBufferHealthV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"bytes\","]
#[doc = "    \"capacityBytes\","]
#[doc = "    \"capacityRecords\","]
#[doc = "    \"highWaterBytes\","]
#[doc = "    \"highWaterRecords\","]
#[doc = "    \"records\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"bytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"capacityBytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"capacityRecords\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"highWaterBytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"highWaterRecords\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"records\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LoggingBufferHealthV1 {
    pub bytes: LogSafeIntegerV1,
    #[serde(rename = "capacityBytes")]
    pub capacity_bytes: LogSafeIntegerV1,
    #[serde(rename = "capacityRecords")]
    pub capacity_records: LogSafeIntegerV1,
    #[serde(rename = "highWaterBytes")]
    pub high_water_bytes: LogSafeIntegerV1,
    #[serde(rename = "highWaterRecords")]
    pub high_water_records: LogSafeIntegerV1,
    pub records: LogSafeIntegerV1,
}
impl LoggingBufferHealthV1 {
    pub fn builder() -> builder::LoggingBufferHealthV1 {
        Default::default()
    }
}
#[doc = "`LoggingCountersV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"accepted\","]
#[doc = "    \"bytesWritten\","]
#[doc = "    \"cleanupDeletions\","]
#[doc = "    \"droppedDebug\","]
#[doc = "    \"droppedError\","]
#[doc = "    \"droppedInfo\","]
#[doc = "    \"droppedTrace\","]
#[doc = "    \"droppedWarn\","]
#[doc = "    \"emergencyFallbacks\","]
#[doc = "    \"rejected\","]
#[doc = "    \"rotations\","]
#[doc = "    \"truncated\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"accepted\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"bytesWritten\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"cleanupDeletions\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"droppedDebug\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"droppedError\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"droppedInfo\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"droppedTrace\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"droppedWarn\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"emergencyFallbacks\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"rejected\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"rotations\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"truncated\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LoggingCountersV1 {
    pub accepted: LogSafeIntegerV1,
    #[serde(rename = "bytesWritten")]
    pub bytes_written: LogSafeIntegerV1,
    #[serde(rename = "cleanupDeletions")]
    pub cleanup_deletions: LogSafeIntegerV1,
    #[serde(rename = "droppedDebug")]
    pub dropped_debug: LogSafeIntegerV1,
    #[serde(rename = "droppedError")]
    pub dropped_error: LogSafeIntegerV1,
    #[serde(rename = "droppedInfo")]
    pub dropped_info: LogSafeIntegerV1,
    #[serde(rename = "droppedTrace")]
    pub dropped_trace: LogSafeIntegerV1,
    #[serde(rename = "droppedWarn")]
    pub dropped_warn: LogSafeIntegerV1,
    #[serde(rename = "emergencyFallbacks")]
    pub emergency_fallbacks: LogSafeIntegerV1,
    pub rejected: LogSafeIntegerV1,
    pub rotations: LogSafeIntegerV1,
    pub truncated: LogSafeIntegerV1,
}
impl LoggingCountersV1 {
    pub fn builder() -> builder::LoggingCountersV1 {
        Default::default()
    }
}
#[doc = "`LoggingFailureV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"kind\","]
#[doc = "    \"message\","]
#[doc = "    \"time\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"kind\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"enum\": ["]
#[doc = "        \"enospc\","]
#[doc = "        \"eacces\","]
#[doc = "        \"read-only\","]
#[doc = "        \"rename\","]
#[doc = "        \"write\","]
#[doc = "        \"flush\","]
#[doc = "        \"close\","]
#[doc = "        \"writer-conflict\","]
#[doc = "        \"unknown\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"message\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 500"]
#[doc = "    },"]
#[doc = "    \"time\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LoggingFailureV1 {
    pub kind: LoggingFailureV1Kind,
    pub message: LoggingFailureV1Message,
    pub time: LogSafeIntegerV1,
}
impl LoggingFailureV1 {
    pub fn builder() -> builder::LoggingFailureV1 {
        Default::default()
    }
}
#[doc = "`LoggingFailureV1Kind`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"enospc\","]
#[doc = "    \"eacces\","]
#[doc = "    \"read-only\","]
#[doc = "    \"rename\","]
#[doc = "    \"write\","]
#[doc = "    \"flush\","]
#[doc = "    \"close\","]
#[doc = "    \"writer-conflict\","]
#[doc = "    \"unknown\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LoggingFailureV1Kind {
    #[serde(rename = "enospc")]
    Enospc,
    #[serde(rename = "eacces")]
    Eacces,
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "rename")]
    Rename,
    #[serde(rename = "write")]
    Write,
    #[serde(rename = "flush")]
    Flush,
    #[serde(rename = "close")]
    Close,
    #[serde(rename = "writer-conflict")]
    WriterConflict,
    #[serde(rename = "unknown")]
    Unknown,
}
impl ::std::fmt::Display for LoggingFailureV1Kind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Enospc => f.write_str("enospc"),
            Self::Eacces => f.write_str("eacces"),
            Self::ReadOnly => f.write_str("read-only"),
            Self::Rename => f.write_str("rename"),
            Self::Write => f.write_str("write"),
            Self::Flush => f.write_str("flush"),
            Self::Close => f.write_str("close"),
            Self::WriterConflict => f.write_str("writer-conflict"),
            Self::Unknown => f.write_str("unknown"),
        }
    }
}
impl ::std::str::FromStr for LoggingFailureV1Kind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "enospc" => Ok(Self::Enospc),
            "eacces" => Ok(Self::Eacces),
            "read-only" => Ok(Self::ReadOnly),
            "rename" => Ok(Self::Rename),
            "write" => Ok(Self::Write),
            "flush" => Ok(Self::Flush),
            "close" => Ok(Self::Close),
            "writer-conflict" => Ok(Self::WriterConflict),
            "unknown" => Ok(Self::Unknown),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LoggingFailureV1Kind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LoggingFailureV1Kind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LoggingFailureV1Kind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`LoggingFailureV1Message`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 500"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct LoggingFailureV1Message(::std::string::String);
impl ::std::ops::Deref for LoggingFailureV1Message {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<LoggingFailureV1Message> for ::std::string::String {
    fn from(value: LoggingFailureV1Message) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for LoggingFailureV1Message {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 500usize {
            return Err("longer than 500 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for LoggingFailureV1Message {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LoggingFailureV1Message {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LoggingFailureV1Message {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for LoggingFailureV1Message {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "vibefield.logging.health.contract.v1"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"description\": \"vibefield.logging.health.contract.v1\","]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"activeLeaseCount\","]
#[doc = "    \"activeSegmentBytes\","]
#[doc = "    \"bootId\","]
#[doc = "    \"counters\","]
#[doc = "    \"currentLevel\","]
#[doc = "    \"instanceId\","]
#[doc = "    \"queue\","]
#[doc = "    \"ring\","]
#[doc = "    \"service\","]
#[doc = "    \"stream\","]
#[doc = "    \"v\","]
#[doc = "    \"writerState\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"activeLeaseCount\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"activeSegmentBytes\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"bootId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"counters\": {"]
#[doc = "      \"$ref\": \"#/definitions/LoggingCountersV1\""]
#[doc = "    },"]
#[doc = "    \"currentLevel\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogLevelNameV1\""]
#[doc = "    },"]
#[doc = "    \"instanceId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"lastFailure\": {"]
#[doc = "      \"$ref\": \"#/definitions/LoggingFailureV1\""]
#[doc = "    },"]
#[doc = "    \"lastWriteAt\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSafeIntegerV1\""]
#[doc = "    },"]
#[doc = "    \"queue\": {"]
#[doc = "      \"$ref\": \"#/definitions/LoggingBufferHealthV1\""]
#[doc = "    },"]
#[doc = "    \"ring\": {"]
#[doc = "      \"$ref\": \"#/definitions/LoggingBufferHealthV1\""]
#[doc = "    },"]
#[doc = "    \"service\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogServiceV1\""]
#[doc = "    },"]
#[doc = "    \"stream\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogStreamV1\""]
#[doc = "    },"]
#[doc = "    \"v\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogSchemaVersionV1\""]
#[doc = "    },"]
#[doc = "    \"writerState\": {"]
#[doc = "      \"$ref\": \"#/definitions/LoggingWriterStateV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct LoggingHealthV1 {
    #[serde(rename = "activeLeaseCount")]
    pub active_lease_count: LogSafeIntegerV1,
    #[serde(rename = "activeSegmentBytes")]
    pub active_segment_bytes: LogSafeIntegerV1,
    #[serde(rename = "bootId")]
    pub boot_id: LogBoundedIdentityV1,
    pub counters: LoggingCountersV1,
    #[serde(rename = "currentLevel")]
    pub current_level: LogLevelNameV1,
    #[serde(rename = "instanceId")]
    pub instance_id: LogBoundedIdentityV1,
    #[serde(
        rename = "lastFailure",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub last_failure: ::std::option::Option<LoggingFailureV1>,
    #[serde(
        rename = "lastWriteAt",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub last_write_at: ::std::option::Option<LogSafeIntegerV1>,
    pub queue: LoggingBufferHealthV1,
    pub ring: LoggingBufferHealthV1,
    pub service: LogServiceV1,
    pub stream: LogStreamV1,
    pub v: LogSchemaVersionV1,
    #[serde(rename = "writerState")]
    pub writer_state: LoggingWriterStateV1,
}
impl LoggingHealthV1 {
    pub fn builder() -> builder::LoggingHealthV1 {
        Default::default()
    }
}
#[doc = "`LoggingWriterStateV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"starting\","]
#[doc = "    \"healthy\","]
#[doc = "    \"degraded\","]
#[doc = "    \"closed\","]
#[doc = "    \"writer-conflict\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum LoggingWriterStateV1 {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "healthy")]
    Healthy,
    #[serde(rename = "degraded")]
    Degraded,
    #[serde(rename = "closed")]
    Closed,
    #[serde(rename = "writer-conflict")]
    WriterConflict,
}
impl ::std::fmt::Display for LoggingWriterStateV1 {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Healthy => f.write_str("healthy"),
            Self::Degraded => f.write_str("degraded"),
            Self::Closed => f.write_str("closed"),
            Self::WriterConflict => f.write_str("writer-conflict"),
        }
    }
}
impl ::std::str::FromStr for LoggingWriterStateV1 {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "healthy" => Ok(Self::Healthy),
            "degraded" => Ok(Self::Degraded),
            "closed" => Ok(Self::Closed),
            "writer-conflict" => Ok(Self::WriterConflict),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for LoggingWriterStateV1 {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for LoggingWriterStateV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for LoggingWriterStateV1 {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`MeshConfig`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct MeshConfig(pub ::serde_json::Map<::std::string::String, ::serde_json::Value>);
impl ::std::ops::Deref for MeshConfig {
    type Target = ::serde_json::Map<::std::string::String, ::serde_json::Value>;
    fn deref(&self) -> &::serde_json::Map<::std::string::String, ::serde_json::Value> {
        &self.0
    }
}
impl ::std::convert::From<MeshConfig>
    for ::serde_json::Map<::std::string::String, ::serde_json::Value>
{
    fn from(value: MeshConfig) -> Self {
        value.0
    }
}
impl ::std::convert::From<::serde_json::Map<::std::string::String, ::serde_json::Value>>
    for MeshConfig
{
    fn from(value: ::serde_json::Map<::std::string::String, ::serde_json::Value>) -> Self {
        Self(value)
    }
}
#[doc = "`MeshLaneClass`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"reliable\","]
#[doc = "    \"lossy\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum MeshLaneClass {
    #[serde(rename = "reliable")]
    Reliable,
    #[serde(rename = "lossy")]
    Lossy,
}
impl ::std::fmt::Display for MeshLaneClass {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Reliable => f.write_str("reliable"),
            Self::Lossy => f.write_str("lossy"),
        }
    }
}
impl ::std::str::FromStr for MeshLaneClass {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "reliable" => Ok(Self::Reliable),
            "lossy" => Ok(Self::Lossy),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for MeshLaneClass {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for MeshLaneClass {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for MeshLaneClass {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`MeshLaneCloseRequest`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"laneId\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"laneId\": {"]
#[doc = "      \"type\": \"integer\","]
#[doc = "      \"minimum\": 0.0"]
#[doc = "    },"]
#[doc = "    \"reason\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct MeshLaneCloseRequest {
    #[serde(rename = "laneId")]
    pub lane_id: u64,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub reason: ::std::option::Option<::std::string::String>,
}
impl MeshLaneCloseRequest {
    pub fn builder() -> builder::MeshLaneCloseRequest {
        Default::default()
    }
}
#[doc = "`MeshLaneClosed`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"laneId\","]
#[doc = "    \"reason\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"inbound\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    },"]
#[doc = "    \"laneId\": {"]
#[doc = "      \"type\": \"integer\","]
#[doc = "      \"minimum\": 0.0"]
#[doc = "    },"]
#[doc = "    \"reason\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct MeshLaneClosed {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub inbound: ::std::option::Option<bool>,
    #[serde(rename = "laneId")]
    pub lane_id: u64,
    pub reason: ::std::string::String,
}
impl MeshLaneClosed {
    pub fn builder() -> builder::MeshLaneClosed {
        Default::default()
    }
}
#[doc = "`MeshLaneOpenRequest`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"class\","]
#[doc = "    \"laneId\","]
#[doc = "    \"peer\","]
#[doc = "    \"protocol\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"class\": {"]
#[doc = "      \"$ref\": \"#/definitions/MeshLaneClass\""]
#[doc = "    },"]
#[doc = "    \"docId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"laneId\": {"]
#[doc = "      \"type\": \"integer\","]
#[doc = "      \"minimum\": 0.0"]
#[doc = "    },"]
#[doc = "    \"peer\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"protocol\": {"]
#[doc = "      \"$ref\": \"#/definitions/MeshLaneProtocol\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct MeshLaneOpenRequest {
    pub class: MeshLaneClass,
    #[serde(
        rename = "docId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub doc_id: ::std::option::Option<::std::string::String>,
    #[serde(rename = "laneId")]
    pub lane_id: u64,
    pub peer: ::std::string::String,
    pub protocol: MeshLaneProtocol,
}
impl MeshLaneOpenRequest {
    pub fn builder() -> builder::MeshLaneOpenRequest {
        Default::default()
    }
}
#[doc = "`MeshLanePeerOpened`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"class\","]
#[doc = "    \"inbound\","]
#[doc = "    \"laneId\","]
#[doc = "    \"peer\","]
#[doc = "    \"protocol\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"class\": {"]
#[doc = "      \"$ref\": \"#/definitions/MeshLaneClass\""]
#[doc = "    },"]
#[doc = "    \"docId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"inbound\": {"]
#[doc = "      \"type\": \"boolean\","]
#[doc = "      \"const\": true"]
#[doc = "    },"]
#[doc = "    \"laneId\": {"]
#[doc = "      \"type\": \"integer\","]
#[doc = "      \"minimum\": 0.0"]
#[doc = "    },"]
#[doc = "    \"peer\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"protocol\": {"]
#[doc = "      \"$ref\": \"#/definitions/MeshLaneProtocol\""]
#[doc = "    },"]
#[doc = "    \"whois\": {"]
#[doc = "      \"$ref\": \"#/definitions/WhoIsIdentity\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct MeshLanePeerOpened {
    pub class: MeshLaneClass,
    #[serde(
        rename = "docId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub doc_id: ::std::option::Option<::std::string::String>,
    pub inbound: bool,
    #[serde(rename = "laneId")]
    pub lane_id: u64,
    pub peer: ::std::string::String,
    pub protocol: MeshLaneProtocol,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub whois: ::std::option::Option<WhoIsIdentity>,
}
impl MeshLanePeerOpened {
    pub fn builder() -> builder::MeshLanePeerOpened {
        Default::default()
    }
}
#[doc = "`MeshLaneProtocol`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"doc-sync\","]
#[doc = "    \"presence\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum MeshLaneProtocol {
    #[serde(rename = "doc-sync")]
    DocSync,
    #[serde(rename = "presence")]
    Presence,
}
impl ::std::fmt::Display for MeshLaneProtocol {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::DocSync => f.write_str("doc-sync"),
            Self::Presence => f.write_str("presence"),
        }
    }
}
impl ::std::str::FromStr for MeshLaneProtocol {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "doc-sync" => Ok(Self::DocSync),
            "presence" => Ok(Self::Presence),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for MeshLaneProtocol {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for MeshLaneProtocol {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for MeshLaneProtocol {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`MeshRetireResult`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"archivedTo\","]
#[doc = "    \"retired\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"archivedTo\": {"]
#[doc = "      \"type\": ["]
#[doc = "        \"string\","]
#[doc = "        \"null\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"retired\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct MeshRetireResult {
    #[serde(rename = "archivedTo")]
    pub archived_to: ::std::option::Option<::std::string::String>,
    pub retired: bool,
}
impl MeshRetireResult {
    pub fn builder() -> builder::MeshRetireResult {
        Default::default()
    }
}
#[doc = "`MeshSelfIdentity`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"deviceId\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"deviceId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"deviceName\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"dnsName\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"ip\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"login\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"tailscaleId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct MeshSelfIdentity {
    #[serde(rename = "deviceId")]
    pub device_id: ::std::string::String,
    #[serde(
        rename = "deviceName",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub device_name: ::std::option::Option<::std::string::String>,
    #[serde(
        rename = "dnsName",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub dns_name: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub ip: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub login: ::std::option::Option<::std::string::String>,
    #[serde(
        rename = "tailscaleId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub tailscale_id: ::std::option::Option<::std::string::String>,
}
impl MeshSelfIdentity {
    pub fn builder() -> builder::MeshSelfIdentity {
        Default::default()
    }
}
#[doc = "`NativeHealth`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"bootId\","]
#[doc = "    \"state\","]
#[doc = "    \"units\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"bootId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"state\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"enum\": ["]
#[doc = "        \"starting\","]
#[doc = "        \"up\","]
#[doc = "        \"degraded\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"units\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/UnitHealth\""]
#[doc = "      }"]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct NativeHealth {
    #[serde(rename = "bootId")]
    pub boot_id: ::std::string::String,
    pub state: NativeHealthState,
    pub units: ::std::vec::Vec<UnitHealth>,
}
impl NativeHealth {
    pub fn builder() -> builder::NativeHealth {
        Default::default()
    }
}
#[doc = "`NativeHealthState`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"starting\","]
#[doc = "    \"up\","]
#[doc = "    \"degraded\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum NativeHealthState {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "up")]
    Up,
    #[serde(rename = "degraded")]
    Degraded,
}
impl ::std::fmt::Display for NativeHealthState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Up => f.write_str("up"),
            Self::Degraded => f.write_str("degraded"),
        }
    }
}
impl ::std::str::FromStr for NativeHealthState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "up" => Ok(Self::Up),
            "degraded" => Ok(Self::Degraded),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for NativeHealthState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for NativeHealthState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for NativeHealthState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`ObservedState`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"bootId\","]
#[doc = "    \"generation\","]
#[doc = "    \"terminals\","]
#[doc = "    \"workers\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"bootId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"generation\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"terminals\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/ObservedTerminal\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"workers\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/ObservedWorker\""]
#[doc = "      }"]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ObservedState {
    #[serde(rename = "bootId")]
    pub boot_id: ::std::string::String,
    pub generation: i64,
    pub terminals: ::std::vec::Vec<ObservedTerminal>,
    pub workers: ::std::vec::Vec<ObservedWorker>,
}
impl ObservedState {
    pub fn builder() -> builder::ObservedState {
        Default::default()
    }
}
#[doc = "`ObservedTerminal`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"sessionId\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"cell\": {"]
#[doc = "      \"$ref\": \"#/definitions/ObservedTerminalCell\""]
#[doc = "    },"]
#[doc = "    \"createdAt\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"cwd\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"persistence\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"pid\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"sessionId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"title\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ObservedTerminal {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub cell: ::std::option::Option<ObservedTerminalCell>,
    #[serde(
        rename = "createdAt",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub created_at: ::std::option::Option<i64>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub cwd: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub persistence: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub pid: ::std::option::Option<i64>,
    #[serde(rename = "sessionId")]
    pub session_id: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub title: ::std::option::Option<::std::string::String>,
}
impl ObservedTerminal {
    pub fn builder() -> builder::ObservedTerminal {
        Default::default()
    }
}
#[doc = "`ObservedTerminalCell`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"cellBootId\","]
#[doc = "    \"cellInstanceId\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"cellBootId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"cellInstanceId\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"role\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalCellRole\""]
#[doc = "    },"]
#[doc = "    \"workloadClass\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalWorkloadClass\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ObservedTerminalCell {
    #[serde(rename = "cellBootId")]
    pub cell_boot_id: ::std::string::String,
    #[serde(rename = "cellInstanceId")]
    pub cell_instance_id: i64,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub role: ::std::option::Option<TerminalCellRole>,
    #[serde(
        rename = "workloadClass",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workload_class: ::std::option::Option<TerminalWorkloadClass>,
}
impl ObservedTerminalCell {
    pub fn builder() -> builder::ObservedTerminalCell {
        Default::default()
    }
}
#[doc = "`ObservedWorker`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"id\","]
#[doc = "    \"state\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"id\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"state\": {"]
#[doc = "      \"$ref\": \"#/definitions/UnitState\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ObservedWorker {
    pub id: ::std::string::String,
    pub state: UnitState,
}
impl ObservedWorker {
    pub fn builder() -> builder::ObservedWorker {
        Default::default()
    }
}
#[doc = "`PairingMac`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"bootId\","]
#[doc = "    \"mac\","]
#[doc = "    \"ts\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"bootId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"mac\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"nonce\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"ts\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct PairingMac {
    #[serde(rename = "bootId")]
    pub boot_id: ::std::string::String,
    pub mac: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub nonce: ::std::option::Option<::std::string::String>,
    pub ts: i64,
}
impl PairingMac {
    pub fn builder() -> builder::PairingMac {
        Default::default()
    }
}
#[doc = "`PeerInfo`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"id\","]
#[doc = "    \"online\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"addresses\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"type\": \"string\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"deviceId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"id\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"name\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"online\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    },"]
#[doc = "    \"whois\": {"]
#[doc = "      \"$ref\": \"#/definitions/WhoIsIdentity\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct PeerInfo {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub addresses: ::std::vec::Vec<::std::string::String>,
    #[serde(
        rename = "deviceId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub device_id: ::std::option::Option<::std::string::String>,
    pub id: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub name: ::std::option::Option<::std::string::String>,
    pub online: bool,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub whois: ::std::option::Option<WhoIsIdentity>,
}
impl PeerInfo {
    pub fn builder() -> builder::PeerInfo {
        Default::default()
    }
}
#[doc = "`PluginLogProvenanceV1`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"entry\","]
#[doc = "    \"id\","]
#[doc = "    \"installRevision\","]
#[doc = "    \"installSource\","]
#[doc = "    \"trust\","]
#[doc = "    \"version\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"entry\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"enum\": ["]
#[doc = "        \"renderer\","]
#[doc = "        \"service\","]
#[doc = "        \"utility\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"id\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    },"]
#[doc = "    \"installRevision\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 128,"]
#[doc = "      \"minLength\": 1"]
#[doc = "    },"]
#[doc = "    \"installSource\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"enum\": ["]
#[doc = "        \"bundled\","]
#[doc = "        \"registry\","]
#[doc = "        \"peer\","]
#[doc = "        \"dev-link\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"trust\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"enum\": ["]
#[doc = "        \"r0-bundled\","]
#[doc = "        \"r1-registry\","]
#[doc = "        \"r2-peer\","]
#[doc = "        \"r3-dev\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"version\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"maxLength\": 64,"]
#[doc = "      \"minLength\": 1"]
#[doc = "    },"]
#[doc = "    \"windowId\": {"]
#[doc = "      \"$ref\": \"#/definitions/LogBoundedIdentityV1\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct PluginLogProvenanceV1 {
    pub entry: PluginLogProvenanceV1Entry,
    pub id: LogBoundedIdentityV1,
    #[serde(rename = "installRevision")]
    pub install_revision: PluginLogProvenanceV1InstallRevision,
    #[serde(rename = "installSource")]
    pub install_source: PluginLogProvenanceV1InstallSource,
    pub trust: PluginLogProvenanceV1Trust,
    pub version: PluginLogProvenanceV1Version,
    #[serde(
        rename = "windowId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub window_id: ::std::option::Option<LogBoundedIdentityV1>,
}
impl PluginLogProvenanceV1 {
    pub fn builder() -> builder::PluginLogProvenanceV1 {
        Default::default()
    }
}
#[doc = "`PluginLogProvenanceV1Entry`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"renderer\","]
#[doc = "    \"service\","]
#[doc = "    \"utility\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PluginLogProvenanceV1Entry {
    #[serde(rename = "renderer")]
    Renderer,
    #[serde(rename = "service")]
    Service,
    #[serde(rename = "utility")]
    Utility,
}
impl ::std::fmt::Display for PluginLogProvenanceV1Entry {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Renderer => f.write_str("renderer"),
            Self::Service => f.write_str("service"),
            Self::Utility => f.write_str("utility"),
        }
    }
}
impl ::std::str::FromStr for PluginLogProvenanceV1Entry {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "renderer" => Ok(Self::Renderer),
            "service" => Ok(Self::Service),
            "utility" => Ok(Self::Utility),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PluginLogProvenanceV1Entry {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PluginLogProvenanceV1Entry {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PluginLogProvenanceV1Entry {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`PluginLogProvenanceV1InstallRevision`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 128,"]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct PluginLogProvenanceV1InstallRevision(::std::string::String);
impl ::std::ops::Deref for PluginLogProvenanceV1InstallRevision {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<PluginLogProvenanceV1InstallRevision> for ::std::string::String {
    fn from(value: PluginLogProvenanceV1InstallRevision) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for PluginLogProvenanceV1InstallRevision {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 128usize {
            return Err("longer than 128 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for PluginLogProvenanceV1InstallRevision {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PluginLogProvenanceV1InstallRevision {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PluginLogProvenanceV1InstallRevision {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for PluginLogProvenanceV1InstallRevision {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`PluginLogProvenanceV1InstallSource`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"bundled\","]
#[doc = "    \"registry\","]
#[doc = "    \"peer\","]
#[doc = "    \"dev-link\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PluginLogProvenanceV1InstallSource {
    #[serde(rename = "bundled")]
    Bundled,
    #[serde(rename = "registry")]
    Registry,
    #[serde(rename = "peer")]
    Peer,
    #[serde(rename = "dev-link")]
    DevLink,
}
impl ::std::fmt::Display for PluginLogProvenanceV1InstallSource {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Bundled => f.write_str("bundled"),
            Self::Registry => f.write_str("registry"),
            Self::Peer => f.write_str("peer"),
            Self::DevLink => f.write_str("dev-link"),
        }
    }
}
impl ::std::str::FromStr for PluginLogProvenanceV1InstallSource {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "bundled" => Ok(Self::Bundled),
            "registry" => Ok(Self::Registry),
            "peer" => Ok(Self::Peer),
            "dev-link" => Ok(Self::DevLink),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PluginLogProvenanceV1InstallSource {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PluginLogProvenanceV1InstallSource {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PluginLogProvenanceV1InstallSource {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`PluginLogProvenanceV1Trust`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"r0-bundled\","]
#[doc = "    \"r1-registry\","]
#[doc = "    \"r2-peer\","]
#[doc = "    \"r3-dev\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum PluginLogProvenanceV1Trust {
    #[serde(rename = "r0-bundled")]
    R0Bundled,
    #[serde(rename = "r1-registry")]
    R1Registry,
    #[serde(rename = "r2-peer")]
    R2Peer,
    #[serde(rename = "r3-dev")]
    R3Dev,
}
impl ::std::fmt::Display for PluginLogProvenanceV1Trust {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::R0Bundled => f.write_str("r0-bundled"),
            Self::R1Registry => f.write_str("r1-registry"),
            Self::R2Peer => f.write_str("r2-peer"),
            Self::R3Dev => f.write_str("r3-dev"),
        }
    }
}
impl ::std::str::FromStr for PluginLogProvenanceV1Trust {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "r0-bundled" => Ok(Self::R0Bundled),
            "r1-registry" => Ok(Self::R1Registry),
            "r2-peer" => Ok(Self::R2Peer),
            "r3-dev" => Ok(Self::R3Dev),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for PluginLogProvenanceV1Trust {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PluginLogProvenanceV1Trust {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PluginLogProvenanceV1Trust {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`PluginLogProvenanceV1Version`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"maxLength\": 64,"]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct PluginLogProvenanceV1Version(::std::string::String);
impl ::std::ops::Deref for PluginLogProvenanceV1Version {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<PluginLogProvenanceV1Version> for ::std::string::String {
    fn from(value: PluginLogProvenanceV1Version) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for PluginLogProvenanceV1Version {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() > 64usize {
            return Err("longer than 64 characters".into());
        }
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for PluginLogProvenanceV1Version {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for PluginLogProvenanceV1Version {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for PluginLogProvenanceV1Version {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for PluginLogProvenanceV1Version {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`RpcError`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"code\","]
#[doc = "    \"message\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"code\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"data\": {"]
#[doc = "      \"$ref\": \"#/definitions/ErrorData\""]
#[doc = "    },"]
#[doc = "    \"message\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct RpcError {
    pub code: i64,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub data: ::std::option::Option<ErrorData>,
    pub message: ::std::string::String,
}
impl RpcError {
    pub fn builder() -> builder::RpcError {
        Default::default()
    }
}
#[doc = "`RpcFailure`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"error\","]
#[doc = "    \"id\","]
#[doc = "    \"jsonrpc\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"error\": {"]
#[doc = "      \"$ref\": \"#/definitions/RpcError\""]
#[doc = "    },"]
#[doc = "    \"id\": {"]
#[doc = "      \"$ref\": \"#/definitions/RpcId\""]
#[doc = "    },"]
#[doc = "    \"jsonrpc\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"const\": \"2.0\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct RpcFailure {
    pub error: RpcError,
    pub id: RpcId,
    pub jsonrpc: ::std::string::String,
}
impl RpcFailure {
    pub fn builder() -> builder::RpcFailure {
        Default::default()
    }
}
#[doc = "`RpcId`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"anyOf\": ["]
#[doc = "    {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    }"]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum RpcId {
    String(::std::string::String),
    Integer(i64),
}
impl ::std::fmt::Display for RpcId {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match self {
            Self::String(x) => x.fmt(f),
            Self::Integer(x) => x.fmt(f),
        }
    }
}
impl ::std::convert::From<i64> for RpcId {
    fn from(value: i64) -> Self {
        Self::Integer(value)
    }
}
#[doc = "`RpcNotification`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"jsonrpc\","]
#[doc = "    \"method\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"jsonrpc\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"const\": \"2.0\""]
#[doc = "    },"]
#[doc = "    \"method\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"params\": {}"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct RpcNotification {
    pub jsonrpc: ::std::string::String,
    pub method: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub params: ::std::option::Option<::serde_json::Value>,
}
impl RpcNotification {
    pub fn builder() -> builder::RpcNotification {
        Default::default()
    }
}
#[doc = "`RpcRequest`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"id\","]
#[doc = "    \"jsonrpc\","]
#[doc = "    \"method\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"id\": {"]
#[doc = "      \"$ref\": \"#/definitions/RpcId\""]
#[doc = "    },"]
#[doc = "    \"jsonrpc\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"const\": \"2.0\""]
#[doc = "    },"]
#[doc = "    \"method\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"params\": {}"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct RpcRequest {
    pub id: RpcId,
    pub jsonrpc: ::std::string::String,
    pub method: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub params: ::std::option::Option<::serde_json::Value>,
}
impl RpcRequest {
    pub fn builder() -> builder::RpcRequest {
        Default::default()
    }
}
#[doc = "`RpcResponse`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"anyOf\": ["]
#[doc = "    {"]
#[doc = "      \"$ref\": \"#/definitions/RpcFailure\""]
#[doc = "    },"]
#[doc = "    {"]
#[doc = "      \"$ref\": \"#/definitions/RpcSuccess\""]
#[doc = "    }"]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum RpcResponse {
    Failure(RpcFailure),
    Success(RpcSuccess),
}
impl ::std::convert::From<RpcFailure> for RpcResponse {
    fn from(value: RpcFailure) -> Self {
        Self::Failure(value)
    }
}
impl ::std::convert::From<RpcSuccess> for RpcResponse {
    fn from(value: RpcSuccess) -> Self {
        Self::Success(value)
    }
}
#[doc = "`RpcSuccess`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"id\","]
#[doc = "    \"jsonrpc\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"id\": {"]
#[doc = "      \"$ref\": \"#/definitions/RpcId\""]
#[doc = "    },"]
#[doc = "    \"jsonrpc\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"const\": \"2.0\""]
#[doc = "    },"]
#[doc = "    \"result\": {}"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct RpcSuccess {
    pub id: RpcId,
    pub jsonrpc: ::std::string::String,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub result: ::std::option::Option<::serde_json::Value>,
}
impl RpcSuccess {
    pub fn builder() -> builder::RpcSuccess {
        Default::default()
    }
}
#[doc = "`SemverString`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"pattern\": \"^\\\\d+\\\\.\\\\d+\\\\.\\\\d+(-[0-9A-Za-z.-]+)?$\""]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct SemverString(::std::string::String);
impl ::std::ops::Deref for SemverString {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<SemverString> for ::std::string::String {
    fn from(value: SemverString) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for SemverString {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        static PATTERN: ::std::sync::LazyLock<::regress::Regex> =
            ::std::sync::LazyLock::new(|| {
                ::regress::Regex::new("^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$").unwrap()
            });
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern \"^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$\"".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for SemverString {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for SemverString {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for SemverString {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for SemverString {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ServeConfig`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"name\","]
#[doc = "    \"target\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"allow\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"type\": \"string\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"listenPort\": {"]
#[doc = "      \"type\": \"integer\","]
#[doc = "      \"maximum\": 65535.0,"]
#[doc = "      \"minimum\": 1.0"]
#[doc = "    },"]
#[doc = "    \"name\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"pathSecret\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"previewDir\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"minLength\": 1"]
#[doc = "    },"]
#[doc = "    \"serveId\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"minLength\": 1"]
#[doc = "    },"]
#[doc = "    \"target\": {"]
#[doc = "      \"$ref\": \"#/definitions/ServeTarget\""]
#[doc = "    },"]
#[doc = "    \"tls\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ServeConfig {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub allow: ::std::vec::Vec<::std::string::String>,
    #[serde(
        rename = "listenPort",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub listen_port: ::std::option::Option<::std::num::NonZeroU64>,
    pub name: ::std::string::String,
    #[serde(
        rename = "pathSecret",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub path_secret: ::std::option::Option<::std::string::String>,
    #[serde(
        rename = "previewDir",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub preview_dir: ::std::option::Option<ServeConfigPreviewDir>,
    #[serde(
        rename = "serveId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub serve_id: ::std::option::Option<ServeConfigServeId>,
    pub target: ServeTarget,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub tls: ::std::option::Option<bool>,
}
impl ServeConfig {
    pub fn builder() -> builder::ServeConfig {
        Default::default()
    }
}
#[doc = "`ServeConfigPreviewDir`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ServeConfigPreviewDir(::std::string::String);
impl ::std::ops::Deref for ServeConfigPreviewDir {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ServeConfigPreviewDir> for ::std::string::String {
    fn from(value: ServeConfigPreviewDir) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ServeConfigPreviewDir {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ServeConfigPreviewDir {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ServeConfigPreviewDir {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ServeConfigPreviewDir {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ServeConfigPreviewDir {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ServeConfigServeId`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ServeConfigServeId(::std::string::String);
impl ::std::ops::Deref for ServeConfigServeId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ServeConfigServeId> for ::std::string::String {
    fn from(value: ServeConfigServeId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ServeConfigServeId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ServeConfigServeId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ServeConfigServeId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ServeConfigServeId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ServeConfigServeId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ServeEntry`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"listenPort\","]
#[doc = "    \"name\","]
#[doc = "    \"serveId\","]
#[doc = "    \"target\","]
#[doc = "    \"url\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"allow\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"type\": \"string\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"error\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"listenPort\": {"]
#[doc = "      \"type\": \"integer\","]
#[doc = "      \"maximum\": 65535.0,"]
#[doc = "      \"minimum\": 1.0"]
#[doc = "    },"]
#[doc = "    \"name\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"serveId\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"minLength\": 1"]
#[doc = "    },"]
#[doc = "    \"status\": {"]
#[doc = "      \"type\": \"string\","]
#[doc = "      \"enum\": ["]
#[doc = "        \"starting\","]
#[doc = "        \"running\","]
#[doc = "        \"stopped\","]
#[doc = "        \"error\""]
#[doc = "      ]"]
#[doc = "    },"]
#[doc = "    \"target\": {"]
#[doc = "      \"$ref\": \"#/definitions/ServeTarget\""]
#[doc = "    },"]
#[doc = "    \"tls\": {"]
#[doc = "      \"type\": \"boolean\""]
#[doc = "    },"]
#[doc = "    \"url\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct ServeEntry {
    #[serde(default, skip_serializing_if = "::std::vec::Vec::is_empty")]
    pub allow: ::std::vec::Vec<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub error: ::std::option::Option<::std::string::String>,
    #[serde(rename = "listenPort")]
    pub listen_port: ::std::num::NonZeroU64,
    pub name: ::std::string::String,
    #[serde(rename = "serveId")]
    pub serve_id: ServeEntryServeId,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub status: ::std::option::Option<ServeEntryStatus>,
    pub target: ServeTarget,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub tls: ::std::option::Option<bool>,
    pub url: ::std::string::String,
}
impl ServeEntry {
    pub fn builder() -> builder::ServeEntry {
        Default::default()
    }
}
#[doc = "`ServeEntryServeId`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"minLength\": 1"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Serialize, Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[serde(transparent)]
pub struct ServeEntryServeId(::std::string::String);
impl ::std::ops::Deref for ServeEntryServeId {
    type Target = ::std::string::String;
    fn deref(&self) -> &::std::string::String {
        &self.0
    }
}
impl ::std::convert::From<ServeEntryServeId> for ::std::string::String {
    fn from(value: ServeEntryServeId) -> Self {
        value.0
    }
}
impl ::std::str::FromStr for ServeEntryServeId {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        if value.chars().count() < 1usize {
            return Err("shorter than 1 characters".into());
        }
        Ok(Self(value.to_string()))
    }
}
impl ::std::convert::TryFrom<&str> for ServeEntryServeId {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ServeEntryServeId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ServeEntryServeId {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl<'de> ::serde::Deserialize<'de> for ServeEntryServeId {
    fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
    where
        D: ::serde::Deserializer<'de>,
    {
        ::std::string::String::deserialize(deserializer)?
            .parse()
            .map_err(|e: self::error::ConversionError| {
                <D::Error as ::serde::de::Error>::custom(e.to_string())
            })
    }
}
#[doc = "`ServeEntryStatus`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"starting\","]
#[doc = "    \"running\","]
#[doc = "    \"stopped\","]
#[doc = "    \"error\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ServeEntryStatus {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "error")]
    Error,
}
impl ::std::fmt::Display for ServeEntryStatus {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Running => f.write_str("running"),
            Self::Stopped => f.write_str("stopped"),
            Self::Error => f.write_str("error"),
        }
    }
}
impl ::std::str::FromStr for ServeEntryStatus {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "running" => Ok(Self::Running),
            "stopped" => Ok(Self::Stopped),
            "error" => Ok(Self::Error),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ServeEntryStatus {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ServeEntryStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ServeEntryStatus {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`ServeTarget`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"anyOf\": ["]
#[doc = "    {"]
#[doc = "      \"type\": \"object\","]
#[doc = "      \"required\": ["]
#[doc = "        \"kind\","]
#[doc = "        \"port\""]
#[doc = "      ],"]
#[doc = "      \"properties\": {"]
#[doc = "        \"kind\": {"]
#[doc = "          \"type\": \"string\","]
#[doc = "          \"const\": \"port\""]
#[doc = "        },"]
#[doc = "        \"port\": {"]
#[doc = "          \"type\": \"integer\","]
#[doc = "          \"maximum\": 65535.0,"]
#[doc = "          \"minimum\": 1.0"]
#[doc = "        },"]
#[doc = "        \"scheme\": {"]
#[doc = "          \"type\": \"string\","]
#[doc = "          \"enum\": ["]
#[doc = "            \"http\","]
#[doc = "            \"https\""]
#[doc = "          ]"]
#[doc = "        }"]
#[doc = "      },"]
#[doc = "      \"additionalProperties\": true"]
#[doc = "    },"]
#[doc = "    {"]
#[doc = "      \"type\": \"object\","]
#[doc = "      \"required\": ["]
#[doc = "        \"kind\","]
#[doc = "        \"path\""]
#[doc = "      ],"]
#[doc = "      \"properties\": {"]
#[doc = "        \"fallback\": {"]
#[doc = "          \"type\": \"string\","]
#[doc = "          \"const\": \"/index.html\""]
#[doc = "        },"]
#[doc = "        \"kind\": {"]
#[doc = "          \"type\": \"string\","]
#[doc = "          \"const\": \"dir\""]
#[doc = "        },"]
#[doc = "        \"path\": {"]
#[doc = "          \"type\": \"string\""]
#[doc = "        }"]
#[doc = "      },"]
#[doc = "      \"additionalProperties\": true"]
#[doc = "    }"]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum ServeTarget {
    Variant0 {
        kind: ::std::string::String,
        port: ::std::num::NonZeroU64,
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        scheme: ::std::option::Option<ServeTargetVariant0Scheme>,
    },
    Variant1 {
        #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
        fallback: ::std::option::Option<::std::string::String>,
        kind: ::std::string::String,
        path: ::std::string::String,
    },
}
#[doc = "`ServeTargetVariant0Scheme`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"http\","]
#[doc = "    \"https\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ServeTargetVariant0Scheme {
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "https")]
    Https,
}
impl ::std::fmt::Display for ServeTargetVariant0Scheme {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Http => f.write_str("http"),
            Self::Https => f.write_str("https"),
        }
    }
}
impl ::std::str::FromStr for ServeTargetVariant0Scheme {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "http" => Ok(Self::Http),
            "https" => Ok(Self::Https),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ServeTargetVariant0Scheme {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ServeTargetVariant0Scheme {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ServeTargetVariant0Scheme {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`ServerKind`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"fieldd\","]
#[doc = "    \"field-native\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum ServerKind {
    #[serde(rename = "fieldd")]
    Fieldd,
    #[serde(rename = "field-native")]
    FieldNative,
}
impl ::std::fmt::Display for ServerKind {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Fieldd => f.write_str("fieldd"),
            Self::FieldNative => f.write_str("field-native"),
        }
    }
}
impl ::std::str::FromStr for ServerKind {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "fieldd" => Ok(Self::Fieldd),
            "field-native" => Ok(Self::FieldNative),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for ServerKind {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for ServerKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for ServerKind {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`StoreSnapshot`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"slices\","]
#[doc = "    \"storeId\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"slices\": {"]
#[doc = "      \"type\": \"object\","]
#[doc = "      \"additionalProperties\": {}"]
#[doc = "    },"]
#[doc = "    \"storeId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct StoreSnapshot {
    pub slices: ::serde_json::Map<::std::string::String, ::serde_json::Value>,
    #[serde(rename = "storeId")]
    pub store_id: ::std::string::String,
}
impl StoreSnapshot {
    pub fn builder() -> builder::StoreSnapshot {
        Default::default()
    }
}
#[doc = "`TerminalCellRole`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"class\","]
#[doc = "    \"solo\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum TerminalCellRole {
    #[serde(rename = "class")]
    Class,
    #[serde(rename = "solo")]
    Solo,
}
impl ::std::fmt::Display for TerminalCellRole {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Class => f.write_str("class"),
            Self::Solo => f.write_str("solo"),
        }
    }
}
impl ::std::str::FromStr for TerminalCellRole {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "class" => Ok(Self::Class),
            "solo" => Ok(Self::Solo),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for TerminalCellRole {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for TerminalCellRole {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for TerminalCellRole {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`TerminalEndpoints`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"authToken\","]
#[doc = "    \"controlSocket\","]
#[doc = "    \"frameSocket\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"authToken\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"controlSocket\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"frameSocket\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct TerminalEndpoints {
    #[serde(rename = "authToken")]
    pub auth_token: ::std::string::String,
    #[serde(rename = "controlSocket")]
    pub control_socket: ::std::string::String,
    #[serde(rename = "frameSocket")]
    pub frame_socket: ::std::string::String,
}
impl TerminalEndpoints {
    pub fn builder() -> builder::TerminalEndpoints {
        Default::default()
    }
}
#[doc = "`TerminalRouteCell`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"cellBootId\","]
#[doc = "    \"cellInstanceId\","]
#[doc = "    \"endpoints\","]
#[doc = "    \"pid\","]
#[doc = "    \"tokenGeneration\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"cellBootId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"cellInstanceId\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"doors\": {"]
#[doc = "      \"$ref\": \"#/definitions/CellEndpointSet\""]
#[doc = "    },"]
#[doc = "    \"endpoints\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalEndpoints\""]
#[doc = "    },"]
#[doc = "    \"grantKey\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"grantKeyGeneration\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"pid\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"role\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalCellRole\""]
#[doc = "    },"]
#[doc = "    \"tokenGeneration\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    },"]
#[doc = "    \"workloadClass\": {"]
#[doc = "      \"$ref\": \"#/definitions/TerminalWorkloadClass\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct TerminalRouteCell {
    #[serde(rename = "cellBootId")]
    pub cell_boot_id: ::std::string::String,
    #[serde(rename = "cellInstanceId")]
    pub cell_instance_id: i64,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub doors: ::std::option::Option<CellEndpointSet>,
    pub endpoints: TerminalEndpoints,
    #[serde(
        rename = "grantKey",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub grant_key: ::std::option::Option<::std::string::String>,
    #[serde(
        rename = "grantKeyGeneration",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub grant_key_generation: ::std::option::Option<i64>,
    pub pid: i64,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub role: ::std::option::Option<TerminalCellRole>,
    #[serde(rename = "tokenGeneration")]
    pub token_generation: i64,
    #[serde(
        rename = "workloadClass",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub workload_class: ::std::option::Option<TerminalWorkloadClass>,
}
impl TerminalRouteCell {
    pub fn builder() -> builder::TerminalRouteCell {
        Default::default()
    }
}
#[doc = "`TerminalRouteSnapshot`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"cells\","]
#[doc = "    \"revision\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"cells\": {"]
#[doc = "      \"type\": \"array\","]
#[doc = "      \"items\": {"]
#[doc = "        \"$ref\": \"#/definitions/TerminalRouteCell\""]
#[doc = "      }"]
#[doc = "    },"]
#[doc = "    \"revision\": {"]
#[doc = "      \"type\": \"integer\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct TerminalRouteSnapshot {
    pub cells: ::std::vec::Vec<TerminalRouteCell>,
    pub revision: i64,
}
impl TerminalRouteSnapshot {
    pub fn builder() -> builder::TerminalRouteSnapshot {
        Default::default()
    }
}
#[doc = "`TerminalWorkloadClass`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"agent\","]
#[doc = "    \"interactive\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum TerminalWorkloadClass {
    #[serde(rename = "agent")]
    Agent,
    #[serde(rename = "interactive")]
    Interactive,
}
impl ::std::fmt::Display for TerminalWorkloadClass {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Agent => f.write_str("agent"),
            Self::Interactive => f.write_str("interactive"),
        }
    }
}
impl ::std::str::FromStr for TerminalWorkloadClass {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "agent" => Ok(Self::Agent),
            "interactive" => Ok(Self::Interactive),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for TerminalWorkloadClass {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for TerminalWorkloadClass {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for TerminalWorkloadClass {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`UnavailableDetails`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"service\","]
#[doc = "    \"state\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"device\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"progress\": {"]
#[doc = "      \"type\": \"number\","]
#[doc = "      \"maximum\": 1.0,"]
#[doc = "      \"minimum\": 0.0"]
#[doc = "    },"]
#[doc = "    \"service\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"state\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct UnavailableDetails {
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub device: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub progress: ::std::option::Option<f64>,
    pub service: ::std::string::String,
    pub state: ::std::string::String,
}
impl UnavailableDetails {
    pub fn builder() -> builder::UnavailableDetails {
        Default::default()
    }
}
#[doc = "`UnitHealth`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"state\","]
#[doc = "    \"unit\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"authUrl\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"detail\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"state\": {"]
#[doc = "      \"$ref\": \"#/definitions/UnitState\""]
#[doc = "    },"]
#[doc = "    \"unit\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct UnitHealth {
    #[serde(
        rename = "authUrl",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub auth_url: ::std::option::Option<::std::string::String>,
    #[serde(default, skip_serializing_if = "::std::option::Option::is_none")]
    pub detail: ::std::option::Option<::std::string::String>,
    pub state: UnitState,
    pub unit: ::std::string::String,
}
impl UnitHealth {
    pub fn builder() -> builder::UnitHealth {
        Default::default()
    }
}
#[doc = "`UnitState`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"string\","]
#[doc = "  \"enum\": ["]
#[doc = "    \"starting\","]
#[doc = "    \"up\","]
#[doc = "    \"degraded\","]
#[doc = "    \"crashed\","]
#[doc = "    \"disabled\""]
#[doc = "  ]"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(
    :: serde :: Deserialize,
    :: serde :: Serialize,
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
)]
pub enum UnitState {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "up")]
    Up,
    #[serde(rename = "degraded")]
    Degraded,
    #[serde(rename = "crashed")]
    Crashed,
    #[serde(rename = "disabled")]
    Disabled,
}
impl ::std::fmt::Display for UnitState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Up => f.write_str("up"),
            Self::Degraded => f.write_str("degraded"),
            Self::Crashed => f.write_str("crashed"),
            Self::Disabled => f.write_str("disabled"),
        }
    }
}
impl ::std::str::FromStr for UnitState {
    type Err = self::error::ConversionError;
    fn from_str(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        match value {
            "starting" => Ok(Self::Starting),
            "up" => Ok(Self::Up),
            "degraded" => Ok(Self::Degraded),
            "crashed" => Ok(Self::Crashed),
            "disabled" => Ok(Self::Disabled),
            _ => Err("invalid value".into()),
        }
    }
}
impl ::std::convert::TryFrom<&str> for UnitState {
    type Error = self::error::ConversionError;
    fn try_from(value: &str) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<&::std::string::String> for UnitState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: &::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
impl ::std::convert::TryFrom<::std::string::String> for UnitState {
    type Error = self::error::ConversionError;
    fn try_from(
        value: ::std::string::String,
    ) -> ::std::result::Result<Self, self::error::ConversionError> {
        value.parse()
    }
}
#[doc = "`WhoIsIdentity`"]
#[doc = r""]
#[doc = r" <details><summary>JSON schema</summary>"]
#[doc = r""]
#[doc = r" ```json"]
#[doc = "{"]
#[doc = "  \"type\": \"object\","]
#[doc = "  \"required\": ["]
#[doc = "    \"login\""]
#[doc = "  ],"]
#[doc = "  \"properties\": {"]
#[doc = "    \"deviceName\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"login\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"tailscaleId\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    }"]
#[doc = "  },"]
#[doc = "  \"additionalProperties\": true"]
#[doc = "}"]
#[doc = r" ```"]
#[doc = r" </details>"]
#[derive(:: serde :: Deserialize, :: serde :: Serialize, Clone, Debug)]
pub struct WhoIsIdentity {
    #[serde(
        rename = "deviceName",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub device_name: ::std::option::Option<::std::string::String>,
    pub login: ::std::string::String,
    #[serde(
        rename = "tailscaleId",
        default,
        skip_serializing_if = "::std::option::Option::is_none"
    )]
    pub tailscale_id: ::std::option::Option<::std::string::String>,
}
impl WhoIsIdentity {
    pub fn builder() -> builder::WhoIsIdentity {
        Default::default()
    }
}
#[doc = r" Types for composing complex structures."]
pub mod builder {
    #[derive(Clone, Debug)]
    pub struct CellEndpointSet {
        control_url: ::std::result::Result<super::CellEndpointSetControlUrl, ::std::string::String>,
        frames_url: ::std::result::Result<super::CellEndpointSetFramesUrl, ::std::string::String>,
    }
    impl ::std::default::Default for CellEndpointSet {
        fn default() -> Self {
            Self {
                control_url: Err("no value supplied for control_url".to_string()),
                frames_url: Err("no value supplied for frames_url".to_string()),
            }
        }
    }
    impl CellEndpointSet {
        pub fn control_url<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::CellEndpointSetControlUrl>,
            T::Error: ::std::fmt::Display,
        {
            self.control_url = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for control_url: {e}"));
            self
        }
        pub fn frames_url<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::CellEndpointSetFramesUrl>,
            T::Error: ::std::fmt::Display,
        {
            self.frames_url = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for frames_url: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<CellEndpointSet> for super::CellEndpointSet {
        type Error = super::error::ConversionError;
        fn try_from(
            value: CellEndpointSet,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                control_url: value.control_url?,
                frames_url: value.frames_url?,
            })
        }
    }
    impl ::std::convert::From<super::CellEndpointSet> for CellEndpointSet {
        fn from(value: super::CellEndpointSet) -> Self {
            Self {
                control_url: Ok(value.control_url),
                frames_url: Ok(value.frames_url),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DesiredState {
        generation: ::std::result::Result<i64, ::std::string::String>,
        mesh_config:
            ::std::result::Result<::std::option::Option<super::MeshConfig>, ::std::string::String>,
        observed_boot_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        terminals:
            ::std::result::Result<::std::vec::Vec<super::DesiredTerminal>, ::std::string::String>,
        workers:
            ::std::result::Result<::std::vec::Vec<super::DesiredWorker>, ::std::string::String>,
    }
    impl ::std::default::Default for DesiredState {
        fn default() -> Self {
            Self {
                generation: Err("no value supplied for generation".to_string()),
                mesh_config: Ok(Default::default()),
                observed_boot_id: Ok(Default::default()),
                terminals: Err("no value supplied for terminals".to_string()),
                workers: Err("no value supplied for workers".to_string()),
            }
        }
    }
    impl DesiredState {
        pub fn generation<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.generation = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for generation: {e}"));
            self
        }
        pub fn mesh_config<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::MeshConfig>>,
            T::Error: ::std::fmt::Display,
        {
            self.mesh_config = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for mesh_config: {e}"));
            self
        }
        pub fn observed_boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.observed_boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for observed_boot_id: {e}"));
            self
        }
        pub fn terminals<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::DesiredTerminal>>,
            T::Error: ::std::fmt::Display,
        {
            self.terminals = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for terminals: {e}"));
            self
        }
        pub fn workers<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::DesiredWorker>>,
            T::Error: ::std::fmt::Display,
        {
            self.workers = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for workers: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DesiredState> for super::DesiredState {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DesiredState,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                generation: value.generation?,
                mesh_config: value.mesh_config?,
                observed_boot_id: value.observed_boot_id?,
                terminals: value.terminals?,
                workers: value.workers?,
            })
        }
    }
    impl ::std::convert::From<super::DesiredState> for DesiredState {
        fn from(value: super::DesiredState) -> Self {
            Self {
                generation: Ok(value.generation),
                mesh_config: Ok(value.mesh_config),
                observed_boot_id: Ok(value.observed_boot_id),
                terminals: Ok(value.terminals),
                workers: Ok(value.workers),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DesiredTerminal {
        persistence: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        session_id: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for DesiredTerminal {
        fn default() -> Self {
            Self {
                persistence: Ok(Default::default()),
                session_id: Err("no value supplied for session_id".to_string()),
            }
        }
    }
    impl DesiredTerminal {
        pub fn persistence<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.persistence = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for persistence: {e}"));
            self
        }
        pub fn session_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.session_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for session_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DesiredTerminal> for super::DesiredTerminal {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DesiredTerminal,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                persistence: value.persistence?,
                session_id: value.session_id?,
            })
        }
    }
    impl ::std::convert::From<super::DesiredTerminal> for DesiredTerminal {
        fn from(value: super::DesiredTerminal) -> Self {
            Self {
                persistence: Ok(value.persistence),
                session_id: Ok(value.session_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DesiredWorker {
        config: ::std::result::Result<
            ::std::option::Option<::serde_json::Value>,
            ::std::string::String,
        >,
        id: ::std::result::Result<::std::string::String, ::std::string::String>,
        kind: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for DesiredWorker {
        fn default() -> Self {
            Self {
                config: Ok(Default::default()),
                id: Err("no value supplied for id".to_string()),
                kind: Err("no value supplied for kind".to_string()),
            }
        }
    }
    impl DesiredWorker {
        pub fn config<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::serde_json::Value>>,
            T::Error: ::std::fmt::Display,
        {
            self.config = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for config: {e}"));
            self
        }
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn kind<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.kind = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for kind: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DesiredWorker> for super::DesiredWorker {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DesiredWorker,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                config: value.config?,
                id: value.id?,
                kind: value.kind?,
            })
        }
    }
    impl ::std::convert::From<super::DesiredWorker> for DesiredWorker {
        fn from(value: super::DesiredWorker) -> Self {
            Self {
                config: Ok(value.config),
                id: Ok(value.id),
                kind: Ok(value.kind),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DiagnosticLogDeltaV1 {
        cursor: ::std::result::Result<super::DiagnosticCursorV1, ::std::string::String>,
        dropped_since_previous:
            ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        records: ::std::result::Result<::std::vec::Vec<super::LogRecordV1>, ::std::string::String>,
        transport_truncated_records: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        v: ::std::result::Result<super::LogSchemaVersionV1, ::std::string::String>,
    }
    impl ::std::default::Default for DiagnosticLogDeltaV1 {
        fn default() -> Self {
            Self {
                cursor: Err("no value supplied for cursor".to_string()),
                dropped_since_previous: Err(
                    "no value supplied for dropped_since_previous".to_string()
                ),
                records: Err("no value supplied for records".to_string()),
                transport_truncated_records: Ok(Default::default()),
                v: Err("no value supplied for v".to_string()),
            }
        }
    }
    impl DiagnosticLogDeltaV1 {
        pub fn cursor<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::DiagnosticCursorV1>,
            T::Error: ::std::fmt::Display,
        {
            self.cursor = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cursor: {e}"));
            self
        }
        pub fn dropped_since_previous<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_since_previous = value.try_into().map_err(|e| {
                format!("error converting supplied value for dropped_since_previous: {e}")
            });
            self
        }
        pub fn records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::LogRecordV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.records = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for records: {e}"));
            self
        }
        pub fn transport_truncated_records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.transport_truncated_records = value.try_into().map_err(|e| {
                format!("error converting supplied value for transport_truncated_records: {e}")
            });
            self
        }
        pub fn v<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSchemaVersionV1>,
            T::Error: ::std::fmt::Display,
        {
            self.v = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for v: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DiagnosticLogDeltaV1> for super::DiagnosticLogDeltaV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DiagnosticLogDeltaV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                cursor: value.cursor?,
                dropped_since_previous: value.dropped_since_previous?,
                records: value.records?,
                transport_truncated_records: value.transport_truncated_records?,
                v: value.v?,
            })
        }
    }
    impl ::std::convert::From<super::DiagnosticLogDeltaV1> for DiagnosticLogDeltaV1 {
        fn from(value: super::DiagnosticLogDeltaV1) -> Self {
            Self {
                cursor: Ok(value.cursor),
                dropped_since_previous: Ok(value.dropped_since_previous),
                records: Ok(value.records),
                transport_truncated_records: Ok(value.transport_truncated_records),
                v: Ok(value.v),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DiagnosticLogSnapshotV1 {
        dropped_before: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        history: ::std::result::Result<
            ::std::option::Option<super::DiagnosticLogSnapshotV1History>,
            ::std::string::String,
        >,
        next_cursor: ::std::result::Result<super::DiagnosticCursorV1, ::std::string::String>,
        producers: ::std::result::Result<
            ::std::vec::Vec<super::DiagnosticProducerStateV1>,
            ::std::string::String,
        >,
        records: ::std::result::Result<::std::vec::Vec<super::LogRecordV1>, ::std::string::String>,
        transport_truncated_records: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        v: ::std::result::Result<super::LogSchemaVersionV1, ::std::string::String>,
    }
    impl ::std::default::Default for DiagnosticLogSnapshotV1 {
        fn default() -> Self {
            Self {
                dropped_before: Err("no value supplied for dropped_before".to_string()),
                history: Ok(Default::default()),
                next_cursor: Err("no value supplied for next_cursor".to_string()),
                producers: Err("no value supplied for producers".to_string()),
                records: Err("no value supplied for records".to_string()),
                transport_truncated_records: Ok(Default::default()),
                v: Err("no value supplied for v".to_string()),
            }
        }
    }
    impl DiagnosticLogSnapshotV1 {
        pub fn dropped_before<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_before = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_before: {e}"));
            self
        }
        pub fn history<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<
                ::std::option::Option<super::DiagnosticLogSnapshotV1History>,
            >,
            T::Error: ::std::fmt::Display,
        {
            self.history = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for history: {e}"));
            self
        }
        pub fn next_cursor<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::DiagnosticCursorV1>,
            T::Error: ::std::fmt::Display,
        {
            self.next_cursor = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for next_cursor: {e}"));
            self
        }
        pub fn producers<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::DiagnosticProducerStateV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.producers = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for producers: {e}"));
            self
        }
        pub fn records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::LogRecordV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.records = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for records: {e}"));
            self
        }
        pub fn transport_truncated_records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.transport_truncated_records = value.try_into().map_err(|e| {
                format!("error converting supplied value for transport_truncated_records: {e}")
            });
            self
        }
        pub fn v<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSchemaVersionV1>,
            T::Error: ::std::fmt::Display,
        {
            self.v = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for v: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DiagnosticLogSnapshotV1> for super::DiagnosticLogSnapshotV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DiagnosticLogSnapshotV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                dropped_before: value.dropped_before?,
                history: value.history?,
                next_cursor: value.next_cursor?,
                producers: value.producers?,
                records: value.records?,
                transport_truncated_records: value.transport_truncated_records?,
                v: value.v?,
            })
        }
    }
    impl ::std::convert::From<super::DiagnosticLogSnapshotV1> for DiagnosticLogSnapshotV1 {
        fn from(value: super::DiagnosticLogSnapshotV1) -> Self {
            Self {
                dropped_before: Ok(value.dropped_before),
                history: Ok(value.history),
                next_cursor: Ok(value.next_cursor),
                producers: Ok(value.producers),
                records: Ok(value.records),
                transport_truncated_records: Ok(value.transport_truncated_records),
                v: Ok(value.v),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DiagnosticLogSnapshotV1History {
        parse_failures: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        scanned_bytes: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        scanned_segments: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        skipped_unsafe_segments:
            ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        truncated: ::std::result::Result<bool, ::std::string::String>,
    }
    impl ::std::default::Default for DiagnosticLogSnapshotV1History {
        fn default() -> Self {
            Self {
                parse_failures: Err("no value supplied for parse_failures".to_string()),
                scanned_bytes: Err("no value supplied for scanned_bytes".to_string()),
                scanned_segments: Err("no value supplied for scanned_segments".to_string()),
                skipped_unsafe_segments: Err(
                    "no value supplied for skipped_unsafe_segments".to_string()
                ),
                truncated: Err("no value supplied for truncated".to_string()),
            }
        }
    }
    impl DiagnosticLogSnapshotV1History {
        pub fn parse_failures<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.parse_failures = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for parse_failures: {e}"));
            self
        }
        pub fn scanned_bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.scanned_bytes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for scanned_bytes: {e}"));
            self
        }
        pub fn scanned_segments<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.scanned_segments = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for scanned_segments: {e}"));
            self
        }
        pub fn skipped_unsafe_segments<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.skipped_unsafe_segments = value.try_into().map_err(|e| {
                format!("error converting supplied value for skipped_unsafe_segments: {e}")
            });
            self
        }
        pub fn truncated<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<bool>,
            T::Error: ::std::fmt::Display,
        {
            self.truncated = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for truncated: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DiagnosticLogSnapshotV1History>
        for super::DiagnosticLogSnapshotV1History
    {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DiagnosticLogSnapshotV1History,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                parse_failures: value.parse_failures?,
                scanned_bytes: value.scanned_bytes?,
                scanned_segments: value.scanned_segments?,
                skipped_unsafe_segments: value.skipped_unsafe_segments?,
                truncated: value.truncated?,
            })
        }
    }
    impl ::std::convert::From<super::DiagnosticLogSnapshotV1History>
        for DiagnosticLogSnapshotV1History
    {
        fn from(value: super::DiagnosticLogSnapshotV1History) -> Self {
            Self {
                parse_failures: Ok(value.parse_failures),
                scanned_bytes: Ok(value.scanned_bytes),
                scanned_segments: Ok(value.scanned_segments),
                skipped_unsafe_segments: Ok(value.skipped_unsafe_segments),
                truncated: Ok(value.truncated),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct DiagnosticProducerStateV1 {
        boot_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        dropped_before: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        health: ::std::result::Result<super::LoggingHealthV1, ::std::string::String>,
        instance_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        newest_cursor: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        oldest_cursor: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        producer_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        service: ::std::result::Result<super::LogServiceV1, ::std::string::String>,
        stream: ::std::result::Result<super::LogStreamV1, ::std::string::String>,
    }
    impl ::std::default::Default for DiagnosticProducerStateV1 {
        fn default() -> Self {
            Self {
                boot_id: Err("no value supplied for boot_id".to_string()),
                dropped_before: Err("no value supplied for dropped_before".to_string()),
                health: Err("no value supplied for health".to_string()),
                instance_id: Err("no value supplied for instance_id".to_string()),
                newest_cursor: Err("no value supplied for newest_cursor".to_string()),
                oldest_cursor: Err("no value supplied for oldest_cursor".to_string()),
                producer_id: Err("no value supplied for producer_id".to_string()),
                service: Err("no value supplied for service".to_string()),
                stream: Err("no value supplied for stream".to_string()),
            }
        }
    }
    impl DiagnosticProducerStateV1 {
        pub fn boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for boot_id: {e}"));
            self
        }
        pub fn dropped_before<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_before = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_before: {e}"));
            self
        }
        pub fn health<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingHealthV1>,
            T::Error: ::std::fmt::Display,
        {
            self.health = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for health: {e}"));
            self
        }
        pub fn instance_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.instance_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for instance_id: {e}"));
            self
        }
        pub fn newest_cursor<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.newest_cursor = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for newest_cursor: {e}"));
            self
        }
        pub fn oldest_cursor<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.oldest_cursor = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for oldest_cursor: {e}"));
            self
        }
        pub fn producer_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.producer_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for producer_id: {e}"));
            self
        }
        pub fn service<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogServiceV1>,
            T::Error: ::std::fmt::Display,
        {
            self.service = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for service: {e}"));
            self
        }
        pub fn stream<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogStreamV1>,
            T::Error: ::std::fmt::Display,
        {
            self.stream = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for stream: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<DiagnosticProducerStateV1> for super::DiagnosticProducerStateV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: DiagnosticProducerStateV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                boot_id: value.boot_id?,
                dropped_before: value.dropped_before?,
                health: value.health?,
                instance_id: value.instance_id?,
                newest_cursor: value.newest_cursor?,
                oldest_cursor: value.oldest_cursor?,
                producer_id: value.producer_id?,
                service: value.service?,
                stream: value.stream?,
            })
        }
    }
    impl ::std::convert::From<super::DiagnosticProducerStateV1> for DiagnosticProducerStateV1 {
        fn from(value: super::DiagnosticProducerStateV1) -> Self {
            Self {
                boot_id: Ok(value.boot_id),
                dropped_before: Ok(value.dropped_before),
                health: Ok(value.health),
                instance_id: Ok(value.instance_id),
                newest_cursor: Ok(value.newest_cursor),
                oldest_cursor: Ok(value.oldest_cursor),
                producer_id: Ok(value.producer_id),
                service: Ok(value.service),
                stream: Ok(value.stream),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ErrorData {
        details: ::std::result::Result<
            ::std::option::Option<::serde_json::Value>,
            ::std::string::String,
        >,
        kind: ::std::result::Result<super::ErrorKind, ::std::string::String>,
        retryable: ::std::result::Result<bool, ::std::string::String>,
    }
    impl ::std::default::Default for ErrorData {
        fn default() -> Self {
            Self {
                details: Ok(Default::default()),
                kind: Err("no value supplied for kind".to_string()),
                retryable: Err("no value supplied for retryable".to_string()),
            }
        }
    }
    impl ErrorData {
        pub fn details<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::serde_json::Value>>,
            T::Error: ::std::fmt::Display,
        {
            self.details = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for details: {e}"));
            self
        }
        pub fn kind<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::ErrorKind>,
            T::Error: ::std::fmt::Display,
        {
            self.kind = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for kind: {e}"));
            self
        }
        pub fn retryable<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<bool>,
            T::Error: ::std::fmt::Display,
        {
            self.retryable = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for retryable: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ErrorData> for super::ErrorData {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ErrorData,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                details: value.details?,
                kind: value.kind?,
                retryable: value.retryable?,
            })
        }
    }
    impl ::std::convert::From<super::ErrorData> for ErrorData {
        fn from(value: super::ErrorData) -> Self {
            Self {
                details: Ok(value.details),
                kind: Ok(value.kind),
                retryable: Ok(value.retryable),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct Hello {
        client_kind: ::std::result::Result<super::ClientKind, ::std::string::String>,
        contracts_version: ::std::result::Result<super::SemverString, ::std::string::String>,
        credential: ::std::result::Result<
            ::std::option::Option<super::HelloCredential>,
            ::std::string::String,
        >,
        device_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        min_compatible: ::std::result::Result<super::SemverString, ::std::string::String>,
        user_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for Hello {
        fn default() -> Self {
            Self {
                client_kind: Err("no value supplied for client_kind".to_string()),
                contracts_version: Err("no value supplied for contracts_version".to_string()),
                credential: Ok(Default::default()),
                device_id: Ok(Default::default()),
                min_compatible: Err("no value supplied for min_compatible".to_string()),
                user_id: Ok(Default::default()),
            }
        }
    }
    impl Hello {
        pub fn client_kind<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::ClientKind>,
            T::Error: ::std::fmt::Display,
        {
            self.client_kind = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for client_kind: {e}"));
            self
        }
        pub fn contracts_version<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::SemverString>,
            T::Error: ::std::fmt::Display,
        {
            self.contracts_version = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for contracts_version: {e}"));
            self
        }
        pub fn credential<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::HelloCredential>>,
            T::Error: ::std::fmt::Display,
        {
            self.credential = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for credential: {e}"));
            self
        }
        pub fn device_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.device_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device_id: {e}"));
            self
        }
        pub fn min_compatible<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::SemverString>,
            T::Error: ::std::fmt::Display,
        {
            self.min_compatible = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for min_compatible: {e}"));
            self
        }
        pub fn user_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.user_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for user_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<Hello> for super::Hello {
        type Error = super::error::ConversionError;
        fn try_from(value: Hello) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                client_kind: value.client_kind?,
                contracts_version: value.contracts_version?,
                credential: value.credential?,
                device_id: value.device_id?,
                min_compatible: value.min_compatible?,
                user_id: value.user_id?,
            })
        }
    }
    impl ::std::convert::From<super::Hello> for Hello {
        fn from(value: super::Hello) -> Self {
            Self {
                client_kind: Ok(value.client_kind),
                contracts_version: Ok(value.contracts_version),
                credential: Ok(value.credential),
                device_id: Ok(value.device_id),
                min_compatible: Ok(value.min_compatible),
                user_id: Ok(value.user_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct HelloAck {
        contracts_version: ::std::result::Result<super::SemverString, ::std::string::String>,
        granted_scopes:
            ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
        native_build: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        server_kind: ::std::result::Result<super::ServerKind, ::std::string::String>,
        server_mac: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        terminal: ::std::result::Result<
            ::std::option::Option<super::TerminalEndpoints>,
            ::std::string::String,
        >,
        terminal_routes: ::std::result::Result<
            ::std::option::Option<super::TerminalRouteSnapshot>,
            ::std::string::String,
        >,
        user_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for HelloAck {
        fn default() -> Self {
            Self {
                contracts_version: Err("no value supplied for contracts_version".to_string()),
                granted_scopes: Err("no value supplied for granted_scopes".to_string()),
                native_build: Ok(Default::default()),
                server_kind: Err("no value supplied for server_kind".to_string()),
                server_mac: Ok(Default::default()),
                terminal: Ok(Default::default()),
                terminal_routes: Ok(Default::default()),
                user_id: Ok(Default::default()),
            }
        }
    }
    impl HelloAck {
        pub fn contracts_version<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::SemverString>,
            T::Error: ::std::fmt::Display,
        {
            self.contracts_version = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for contracts_version: {e}"));
            self
        }
        pub fn granted_scopes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.granted_scopes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for granted_scopes: {e}"));
            self
        }
        pub fn native_build<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.native_build = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for native_build: {e}"));
            self
        }
        pub fn server_kind<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::ServerKind>,
            T::Error: ::std::fmt::Display,
        {
            self.server_kind = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for server_kind: {e}"));
            self
        }
        pub fn server_mac<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.server_mac = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for server_mac: {e}"));
            self
        }
        pub fn terminal<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::TerminalEndpoints>>,
            T::Error: ::std::fmt::Display,
        {
            self.terminal = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for terminal: {e}"));
            self
        }
        pub fn terminal_routes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::TerminalRouteSnapshot>>,
            T::Error: ::std::fmt::Display,
        {
            self.terminal_routes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for terminal_routes: {e}"));
            self
        }
        pub fn user_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.user_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for user_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<HelloAck> for super::HelloAck {
        type Error = super::error::ConversionError;
        fn try_from(value: HelloAck) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                contracts_version: value.contracts_version?,
                granted_scopes: value.granted_scopes?,
                native_build: value.native_build?,
                server_kind: value.server_kind?,
                server_mac: value.server_mac?,
                terminal: value.terminal?,
                terminal_routes: value.terminal_routes?,
                user_id: value.user_id?,
            })
        }
    }
    impl ::std::convert::From<super::HelloAck> for HelloAck {
        fn from(value: super::HelloAck) -> Self {
            Self {
                contracts_version: Ok(value.contracts_version),
                granted_scopes: Ok(value.granted_scopes),
                native_build: Ok(value.native_build),
                server_kind: Ok(value.server_kind),
                server_mac: Ok(value.server_mac),
                terminal: Ok(value.terminal),
                terminal_routes: Ok(value.terminal_routes),
                user_id: Ok(value.user_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LogErrorV1 {
        causes: ::std::result::Result<::std::vec::Vec<super::LogErrorV1>, ::std::string::String>,
        code: ::std::result::Result<
            ::std::option::Option<super::LogErrorV1Code>,
            ::std::string::String,
        >,
        message: ::std::result::Result<super::LogErrorV1Message, ::std::string::String>,
        stack: ::std::result::Result<
            ::std::option::Option<super::LogErrorV1Stack>,
            ::std::string::String,
        >,
        type_: ::std::result::Result<super::LogErrorV1Type, ::std::string::String>,
    }
    impl ::std::default::Default for LogErrorV1 {
        fn default() -> Self {
            Self {
                causes: Ok(Default::default()),
                code: Ok(Default::default()),
                message: Err("no value supplied for message".to_string()),
                stack: Ok(Default::default()),
                type_: Err("no value supplied for type_".to_string()),
            }
        }
    }
    impl LogErrorV1 {
        pub fn causes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::LogErrorV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.causes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for causes: {e}"));
            self
        }
        pub fn code<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogErrorV1Code>>,
            T::Error: ::std::fmt::Display,
        {
            self.code = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for code: {e}"));
            self
        }
        pub fn message<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogErrorV1Message>,
            T::Error: ::std::fmt::Display,
        {
            self.message = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for message: {e}"));
            self
        }
        pub fn stack<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogErrorV1Stack>>,
            T::Error: ::std::fmt::Display,
        {
            self.stack = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for stack: {e}"));
            self
        }
        pub fn type_<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogErrorV1Type>,
            T::Error: ::std::fmt::Display,
        {
            self.type_ = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for type_: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LogErrorV1> for super::LogErrorV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LogErrorV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                causes: value.causes?,
                code: value.code?,
                message: value.message?,
                stack: value.stack?,
                type_: value.type_?,
            })
        }
    }
    impl ::std::convert::From<super::LogErrorV1> for LogErrorV1 {
        fn from(value: super::LogErrorV1) -> Self {
            Self {
                causes: Ok(value.causes),
                code: Ok(value.code),
                message: Ok(value.message),
                stack: Ok(value.stack),
                type_: Ok(value.type_),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LogRecordV1 {
        attrs: ::std::result::Result<
            ::std::option::Option<super::LogAttributesV1>,
            ::std::string::String,
        >,
        boot_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        component: ::std::result::Result<super::LogRecordV1Component, ::std::string::String>,
        device_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        doc_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        err: ::std::result::Result<::std::option::Option<super::LogErrorV1>, ::std::string::String>,
        event: ::std::result::Result<super::LogRecordV1Event, ::std::string::String>,
        instance_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        level: ::std::result::Result<super::LogLevelV1, ::std::string::String>,
        msg: ::std::result::Result<super::LogRecordV1Msg, ::std::string::String>,
        observed_time: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        operation_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        pid: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        plugin: ::std::result::Result<
            ::std::option::Option<super::PluginLogProvenanceV1>,
            ::std::string::String,
        >,
        request_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        role: ::std::result::Result<super::LogRoleV1, ::std::string::String>,
        seq: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        service: ::std::result::Result<super::LogServiceV1, ::std::string::String>,
        session_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        severity: ::std::result::Result<super::LogSeverityV1, ::std::string::String>,
        span_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        time: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        trace_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
        truncation: ::std::result::Result<
            ::std::option::Option<super::LogTruncationV1>,
            ::std::string::String,
        >,
        v: ::std::result::Result<super::LogSchemaVersionV1, ::std::string::String>,
        window_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for LogRecordV1 {
        fn default() -> Self {
            Self {
                attrs: Ok(Default::default()),
                boot_id: Err("no value supplied for boot_id".to_string()),
                component: Err("no value supplied for component".to_string()),
                device_id: Ok(Default::default()),
                doc_id: Ok(Default::default()),
                err: Ok(Default::default()),
                event: Err("no value supplied for event".to_string()),
                instance_id: Err("no value supplied for instance_id".to_string()),
                level: Err("no value supplied for level".to_string()),
                msg: Err("no value supplied for msg".to_string()),
                observed_time: Ok(Default::default()),
                operation_id: Ok(Default::default()),
                pid: Err("no value supplied for pid".to_string()),
                plugin: Ok(Default::default()),
                request_id: Ok(Default::default()),
                role: Err("no value supplied for role".to_string()),
                seq: Err("no value supplied for seq".to_string()),
                service: Err("no value supplied for service".to_string()),
                session_id: Ok(Default::default()),
                severity: Err("no value supplied for severity".to_string()),
                span_id: Ok(Default::default()),
                time: Err("no value supplied for time".to_string()),
                trace_id: Ok(Default::default()),
                truncation: Ok(Default::default()),
                v: Err("no value supplied for v".to_string()),
                window_id: Ok(Default::default()),
            }
        }
    }
    impl LogRecordV1 {
        pub fn attrs<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogAttributesV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.attrs = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for attrs: {e}"));
            self
        }
        pub fn boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for boot_id: {e}"));
            self
        }
        pub fn component<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogRecordV1Component>,
            T::Error: ::std::fmt::Display,
        {
            self.component = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for component: {e}"));
            self
        }
        pub fn device_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.device_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device_id: {e}"));
            self
        }
        pub fn doc_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.doc_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for doc_id: {e}"));
            self
        }
        pub fn err<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogErrorV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.err = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for err: {e}"));
            self
        }
        pub fn event<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogRecordV1Event>,
            T::Error: ::std::fmt::Display,
        {
            self.event = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for event: {e}"));
            self
        }
        pub fn instance_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.instance_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for instance_id: {e}"));
            self
        }
        pub fn level<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogLevelV1>,
            T::Error: ::std::fmt::Display,
        {
            self.level = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for level: {e}"));
            self
        }
        pub fn msg<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogRecordV1Msg>,
            T::Error: ::std::fmt::Display,
        {
            self.msg = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for msg: {e}"));
            self
        }
        pub fn observed_time<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.observed_time = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for observed_time: {e}"));
            self
        }
        pub fn operation_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.operation_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for operation_id: {e}"));
            self
        }
        pub fn pid<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.pid = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for pid: {e}"));
            self
        }
        pub fn plugin<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::PluginLogProvenanceV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.plugin = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for plugin: {e}"));
            self
        }
        pub fn request_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.request_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for request_id: {e}"));
            self
        }
        pub fn role<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogRoleV1>,
            T::Error: ::std::fmt::Display,
        {
            self.role = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for role: {e}"));
            self
        }
        pub fn seq<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.seq = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for seq: {e}"));
            self
        }
        pub fn service<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogServiceV1>,
            T::Error: ::std::fmt::Display,
        {
            self.service = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for service: {e}"));
            self
        }
        pub fn session_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.session_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for session_id: {e}"));
            self
        }
        pub fn severity<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSeverityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.severity = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for severity: {e}"));
            self
        }
        pub fn span_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.span_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for span_id: {e}"));
            self
        }
        pub fn time<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.time = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for time: {e}"));
            self
        }
        pub fn trace_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.trace_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for trace_id: {e}"));
            self
        }
        pub fn truncation<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogTruncationV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.truncation = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for truncation: {e}"));
            self
        }
        pub fn v<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSchemaVersionV1>,
            T::Error: ::std::fmt::Display,
        {
            self.v = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for v: {e}"));
            self
        }
        pub fn window_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.window_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for window_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LogRecordV1> for super::LogRecordV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LogRecordV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                attrs: value.attrs?,
                boot_id: value.boot_id?,
                component: value.component?,
                device_id: value.device_id?,
                doc_id: value.doc_id?,
                err: value.err?,
                event: value.event?,
                instance_id: value.instance_id?,
                level: value.level?,
                msg: value.msg?,
                observed_time: value.observed_time?,
                operation_id: value.operation_id?,
                pid: value.pid?,
                plugin: value.plugin?,
                request_id: value.request_id?,
                role: value.role?,
                seq: value.seq?,
                service: value.service?,
                session_id: value.session_id?,
                severity: value.severity?,
                span_id: value.span_id?,
                time: value.time?,
                trace_id: value.trace_id?,
                truncation: value.truncation?,
                v: value.v?,
                window_id: value.window_id?,
            })
        }
    }
    impl ::std::convert::From<super::LogRecordV1> for LogRecordV1 {
        fn from(value: super::LogRecordV1) -> Self {
            Self {
                attrs: Ok(value.attrs),
                boot_id: Ok(value.boot_id),
                component: Ok(value.component),
                device_id: Ok(value.device_id),
                doc_id: Ok(value.doc_id),
                err: Ok(value.err),
                event: Ok(value.event),
                instance_id: Ok(value.instance_id),
                level: Ok(value.level),
                msg: Ok(value.msg),
                observed_time: Ok(value.observed_time),
                operation_id: Ok(value.operation_id),
                pid: Ok(value.pid),
                plugin: Ok(value.plugin),
                request_id: Ok(value.request_id),
                role: Ok(value.role),
                seq: Ok(value.seq),
                service: Ok(value.service),
                session_id: Ok(value.session_id),
                severity: Ok(value.severity),
                span_id: Ok(value.span_id),
                time: Ok(value.time),
                trace_id: Ok(value.trace_id),
                truncation: Ok(value.truncation),
                v: Ok(value.v),
                window_id: Ok(value.window_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LogTruncationV1 {
        dropped_bytes: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        dropped_items: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        fields: ::std::result::Result<
            ::std::vec::Vec<super::LogTruncationV1FieldsItem>,
            ::std::string::String,
        >,
        original_bytes: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        original_items: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        reasons: ::std::result::Result<
            ::std::vec::Vec<super::LogTruncationReasonV1>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for LogTruncationV1 {
        fn default() -> Self {
            Self {
                dropped_bytes: Ok(Default::default()),
                dropped_items: Ok(Default::default()),
                fields: Ok(Default::default()),
                original_bytes: Ok(Default::default()),
                original_items: Ok(Default::default()),
                reasons: Err("no value supplied for reasons".to_string()),
            }
        }
    }
    impl LogTruncationV1 {
        pub fn dropped_bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_bytes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_bytes: {e}"));
            self
        }
        pub fn dropped_items<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_items = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_items: {e}"));
            self
        }
        pub fn fields<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::LogTruncationV1FieldsItem>>,
            T::Error: ::std::fmt::Display,
        {
            self.fields = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for fields: {e}"));
            self
        }
        pub fn original_bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.original_bytes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for original_bytes: {e}"));
            self
        }
        pub fn original_items<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.original_items = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for original_items: {e}"));
            self
        }
        pub fn reasons<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::LogTruncationReasonV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.reasons = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for reasons: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LogTruncationV1> for super::LogTruncationV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LogTruncationV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                dropped_bytes: value.dropped_bytes?,
                dropped_items: value.dropped_items?,
                fields: value.fields?,
                original_bytes: value.original_bytes?,
                original_items: value.original_items?,
                reasons: value.reasons?,
            })
        }
    }
    impl ::std::convert::From<super::LogTruncationV1> for LogTruncationV1 {
        fn from(value: super::LogTruncationV1) -> Self {
            Self {
                dropped_bytes: Ok(value.dropped_bytes),
                dropped_items: Ok(value.dropped_items),
                fields: Ok(value.fields),
                original_bytes: Ok(value.original_bytes),
                original_items: Ok(value.original_items),
                reasons: Ok(value.reasons),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LoggingBufferHealthV1 {
        bytes: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        capacity_bytes: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        capacity_records: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        high_water_bytes: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        high_water_records: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        records: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
    }
    impl ::std::default::Default for LoggingBufferHealthV1 {
        fn default() -> Self {
            Self {
                bytes: Err("no value supplied for bytes".to_string()),
                capacity_bytes: Err("no value supplied for capacity_bytes".to_string()),
                capacity_records: Err("no value supplied for capacity_records".to_string()),
                high_water_bytes: Err("no value supplied for high_water_bytes".to_string()),
                high_water_records: Err("no value supplied for high_water_records".to_string()),
                records: Err("no value supplied for records".to_string()),
            }
        }
    }
    impl LoggingBufferHealthV1 {
        pub fn bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.bytes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for bytes: {e}"));
            self
        }
        pub fn capacity_bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.capacity_bytes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for capacity_bytes: {e}"));
            self
        }
        pub fn capacity_records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.capacity_records = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for capacity_records: {e}"));
            self
        }
        pub fn high_water_bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.high_water_bytes = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for high_water_bytes: {e}"));
            self
        }
        pub fn high_water_records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.high_water_records = value.try_into().map_err(|e| {
                format!("error converting supplied value for high_water_records: {e}")
            });
            self
        }
        pub fn records<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.records = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for records: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LoggingBufferHealthV1> for super::LoggingBufferHealthV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LoggingBufferHealthV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                bytes: value.bytes?,
                capacity_bytes: value.capacity_bytes?,
                capacity_records: value.capacity_records?,
                high_water_bytes: value.high_water_bytes?,
                high_water_records: value.high_water_records?,
                records: value.records?,
            })
        }
    }
    impl ::std::convert::From<super::LoggingBufferHealthV1> for LoggingBufferHealthV1 {
        fn from(value: super::LoggingBufferHealthV1) -> Self {
            Self {
                bytes: Ok(value.bytes),
                capacity_bytes: Ok(value.capacity_bytes),
                capacity_records: Ok(value.capacity_records),
                high_water_bytes: Ok(value.high_water_bytes),
                high_water_records: Ok(value.high_water_records),
                records: Ok(value.records),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LoggingCountersV1 {
        accepted: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        bytes_written: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        cleanup_deletions: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        dropped_debug: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        dropped_error: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        dropped_info: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        dropped_trace: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        dropped_warn: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        emergency_fallbacks: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        rejected: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        rotations: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        truncated: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
    }
    impl ::std::default::Default for LoggingCountersV1 {
        fn default() -> Self {
            Self {
                accepted: Err("no value supplied for accepted".to_string()),
                bytes_written: Err("no value supplied for bytes_written".to_string()),
                cleanup_deletions: Err("no value supplied for cleanup_deletions".to_string()),
                dropped_debug: Err("no value supplied for dropped_debug".to_string()),
                dropped_error: Err("no value supplied for dropped_error".to_string()),
                dropped_info: Err("no value supplied for dropped_info".to_string()),
                dropped_trace: Err("no value supplied for dropped_trace".to_string()),
                dropped_warn: Err("no value supplied for dropped_warn".to_string()),
                emergency_fallbacks: Err("no value supplied for emergency_fallbacks".to_string()),
                rejected: Err("no value supplied for rejected".to_string()),
                rotations: Err("no value supplied for rotations".to_string()),
                truncated: Err("no value supplied for truncated".to_string()),
            }
        }
    }
    impl LoggingCountersV1 {
        pub fn accepted<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.accepted = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for accepted: {e}"));
            self
        }
        pub fn bytes_written<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.bytes_written = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for bytes_written: {e}"));
            self
        }
        pub fn cleanup_deletions<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.cleanup_deletions = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cleanup_deletions: {e}"));
            self
        }
        pub fn dropped_debug<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_debug = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_debug: {e}"));
            self
        }
        pub fn dropped_error<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_error = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_error: {e}"));
            self
        }
        pub fn dropped_info<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_info = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_info: {e}"));
            self
        }
        pub fn dropped_trace<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_trace = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_trace: {e}"));
            self
        }
        pub fn dropped_warn<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.dropped_warn = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dropped_warn: {e}"));
            self
        }
        pub fn emergency_fallbacks<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.emergency_fallbacks = value.try_into().map_err(|e| {
                format!("error converting supplied value for emergency_fallbacks: {e}")
            });
            self
        }
        pub fn rejected<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.rejected = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for rejected: {e}"));
            self
        }
        pub fn rotations<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.rotations = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for rotations: {e}"));
            self
        }
        pub fn truncated<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.truncated = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for truncated: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LoggingCountersV1> for super::LoggingCountersV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LoggingCountersV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                accepted: value.accepted?,
                bytes_written: value.bytes_written?,
                cleanup_deletions: value.cleanup_deletions?,
                dropped_debug: value.dropped_debug?,
                dropped_error: value.dropped_error?,
                dropped_info: value.dropped_info?,
                dropped_trace: value.dropped_trace?,
                dropped_warn: value.dropped_warn?,
                emergency_fallbacks: value.emergency_fallbacks?,
                rejected: value.rejected?,
                rotations: value.rotations?,
                truncated: value.truncated?,
            })
        }
    }
    impl ::std::convert::From<super::LoggingCountersV1> for LoggingCountersV1 {
        fn from(value: super::LoggingCountersV1) -> Self {
            Self {
                accepted: Ok(value.accepted),
                bytes_written: Ok(value.bytes_written),
                cleanup_deletions: Ok(value.cleanup_deletions),
                dropped_debug: Ok(value.dropped_debug),
                dropped_error: Ok(value.dropped_error),
                dropped_info: Ok(value.dropped_info),
                dropped_trace: Ok(value.dropped_trace),
                dropped_warn: Ok(value.dropped_warn),
                emergency_fallbacks: Ok(value.emergency_fallbacks),
                rejected: Ok(value.rejected),
                rotations: Ok(value.rotations),
                truncated: Ok(value.truncated),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LoggingFailureV1 {
        kind: ::std::result::Result<super::LoggingFailureV1Kind, ::std::string::String>,
        message: ::std::result::Result<super::LoggingFailureV1Message, ::std::string::String>,
        time: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
    }
    impl ::std::default::Default for LoggingFailureV1 {
        fn default() -> Self {
            Self {
                kind: Err("no value supplied for kind".to_string()),
                message: Err("no value supplied for message".to_string()),
                time: Err("no value supplied for time".to_string()),
            }
        }
    }
    impl LoggingFailureV1 {
        pub fn kind<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingFailureV1Kind>,
            T::Error: ::std::fmt::Display,
        {
            self.kind = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for kind: {e}"));
            self
        }
        pub fn message<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingFailureV1Message>,
            T::Error: ::std::fmt::Display,
        {
            self.message = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for message: {e}"));
            self
        }
        pub fn time<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.time = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for time: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LoggingFailureV1> for super::LoggingFailureV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LoggingFailureV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                kind: value.kind?,
                message: value.message?,
                time: value.time?,
            })
        }
    }
    impl ::std::convert::From<super::LoggingFailureV1> for LoggingFailureV1 {
        fn from(value: super::LoggingFailureV1) -> Self {
            Self {
                kind: Ok(value.kind),
                message: Ok(value.message),
                time: Ok(value.time),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct LoggingHealthV1 {
        active_lease_count: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        active_segment_bytes: ::std::result::Result<super::LogSafeIntegerV1, ::std::string::String>,
        boot_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        counters: ::std::result::Result<super::LoggingCountersV1, ::std::string::String>,
        current_level: ::std::result::Result<super::LogLevelNameV1, ::std::string::String>,
        instance_id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        last_failure: ::std::result::Result<
            ::std::option::Option<super::LoggingFailureV1>,
            ::std::string::String,
        >,
        last_write_at: ::std::result::Result<
            ::std::option::Option<super::LogSafeIntegerV1>,
            ::std::string::String,
        >,
        queue: ::std::result::Result<super::LoggingBufferHealthV1, ::std::string::String>,
        ring: ::std::result::Result<super::LoggingBufferHealthV1, ::std::string::String>,
        service: ::std::result::Result<super::LogServiceV1, ::std::string::String>,
        stream: ::std::result::Result<super::LogStreamV1, ::std::string::String>,
        v: ::std::result::Result<super::LogSchemaVersionV1, ::std::string::String>,
        writer_state: ::std::result::Result<super::LoggingWriterStateV1, ::std::string::String>,
    }
    impl ::std::default::Default for LoggingHealthV1 {
        fn default() -> Self {
            Self {
                active_lease_count: Err("no value supplied for active_lease_count".to_string()),
                active_segment_bytes: Err("no value supplied for active_segment_bytes".to_string()),
                boot_id: Err("no value supplied for boot_id".to_string()),
                counters: Err("no value supplied for counters".to_string()),
                current_level: Err("no value supplied for current_level".to_string()),
                instance_id: Err("no value supplied for instance_id".to_string()),
                last_failure: Ok(Default::default()),
                last_write_at: Ok(Default::default()),
                queue: Err("no value supplied for queue".to_string()),
                ring: Err("no value supplied for ring".to_string()),
                service: Err("no value supplied for service".to_string()),
                stream: Err("no value supplied for stream".to_string()),
                v: Err("no value supplied for v".to_string()),
                writer_state: Err("no value supplied for writer_state".to_string()),
            }
        }
    }
    impl LoggingHealthV1 {
        pub fn active_lease_count<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.active_lease_count = value.try_into().map_err(|e| {
                format!("error converting supplied value for active_lease_count: {e}")
            });
            self
        }
        pub fn active_segment_bytes<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSafeIntegerV1>,
            T::Error: ::std::fmt::Display,
        {
            self.active_segment_bytes = value.try_into().map_err(|e| {
                format!("error converting supplied value for active_segment_bytes: {e}")
            });
            self
        }
        pub fn boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for boot_id: {e}"));
            self
        }
        pub fn counters<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingCountersV1>,
            T::Error: ::std::fmt::Display,
        {
            self.counters = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for counters: {e}"));
            self
        }
        pub fn current_level<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogLevelNameV1>,
            T::Error: ::std::fmt::Display,
        {
            self.current_level = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for current_level: {e}"));
            self
        }
        pub fn instance_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.instance_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for instance_id: {e}"));
            self
        }
        pub fn last_failure<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LoggingFailureV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.last_failure = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for last_failure: {e}"));
            self
        }
        pub fn last_write_at<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogSafeIntegerV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.last_write_at = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for last_write_at: {e}"));
            self
        }
        pub fn queue<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingBufferHealthV1>,
            T::Error: ::std::fmt::Display,
        {
            self.queue = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for queue: {e}"));
            self
        }
        pub fn ring<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingBufferHealthV1>,
            T::Error: ::std::fmt::Display,
        {
            self.ring = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for ring: {e}"));
            self
        }
        pub fn service<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogServiceV1>,
            T::Error: ::std::fmt::Display,
        {
            self.service = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for service: {e}"));
            self
        }
        pub fn stream<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogStreamV1>,
            T::Error: ::std::fmt::Display,
        {
            self.stream = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for stream: {e}"));
            self
        }
        pub fn v<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogSchemaVersionV1>,
            T::Error: ::std::fmt::Display,
        {
            self.v = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for v: {e}"));
            self
        }
        pub fn writer_state<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LoggingWriterStateV1>,
            T::Error: ::std::fmt::Display,
        {
            self.writer_state = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for writer_state: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<LoggingHealthV1> for super::LoggingHealthV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: LoggingHealthV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                active_lease_count: value.active_lease_count?,
                active_segment_bytes: value.active_segment_bytes?,
                boot_id: value.boot_id?,
                counters: value.counters?,
                current_level: value.current_level?,
                instance_id: value.instance_id?,
                last_failure: value.last_failure?,
                last_write_at: value.last_write_at?,
                queue: value.queue?,
                ring: value.ring?,
                service: value.service?,
                stream: value.stream?,
                v: value.v?,
                writer_state: value.writer_state?,
            })
        }
    }
    impl ::std::convert::From<super::LoggingHealthV1> for LoggingHealthV1 {
        fn from(value: super::LoggingHealthV1) -> Self {
            Self {
                active_lease_count: Ok(value.active_lease_count),
                active_segment_bytes: Ok(value.active_segment_bytes),
                boot_id: Ok(value.boot_id),
                counters: Ok(value.counters),
                current_level: Ok(value.current_level),
                instance_id: Ok(value.instance_id),
                last_failure: Ok(value.last_failure),
                last_write_at: Ok(value.last_write_at),
                queue: Ok(value.queue),
                ring: Ok(value.ring),
                service: Ok(value.service),
                stream: Ok(value.stream),
                v: Ok(value.v),
                writer_state: Ok(value.writer_state),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct MeshLaneCloseRequest {
        lane_id: ::std::result::Result<u64, ::std::string::String>,
        reason: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for MeshLaneCloseRequest {
        fn default() -> Self {
            Self {
                lane_id: Err("no value supplied for lane_id".to_string()),
                reason: Ok(Default::default()),
            }
        }
    }
    impl MeshLaneCloseRequest {
        pub fn lane_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<u64>,
            T::Error: ::std::fmt::Display,
        {
            self.lane_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for lane_id: {e}"));
            self
        }
        pub fn reason<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.reason = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for reason: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<MeshLaneCloseRequest> for super::MeshLaneCloseRequest {
        type Error = super::error::ConversionError;
        fn try_from(
            value: MeshLaneCloseRequest,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                lane_id: value.lane_id?,
                reason: value.reason?,
            })
        }
    }
    impl ::std::convert::From<super::MeshLaneCloseRequest> for MeshLaneCloseRequest {
        fn from(value: super::MeshLaneCloseRequest) -> Self {
            Self {
                lane_id: Ok(value.lane_id),
                reason: Ok(value.reason),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct MeshLaneClosed {
        inbound: ::std::result::Result<::std::option::Option<bool>, ::std::string::String>,
        lane_id: ::std::result::Result<u64, ::std::string::String>,
        reason: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for MeshLaneClosed {
        fn default() -> Self {
            Self {
                inbound: Ok(Default::default()),
                lane_id: Err("no value supplied for lane_id".to_string()),
                reason: Err("no value supplied for reason".to_string()),
            }
        }
    }
    impl MeshLaneClosed {
        pub fn inbound<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<bool>>,
            T::Error: ::std::fmt::Display,
        {
            self.inbound = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for inbound: {e}"));
            self
        }
        pub fn lane_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<u64>,
            T::Error: ::std::fmt::Display,
        {
            self.lane_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for lane_id: {e}"));
            self
        }
        pub fn reason<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.reason = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for reason: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<MeshLaneClosed> for super::MeshLaneClosed {
        type Error = super::error::ConversionError;
        fn try_from(
            value: MeshLaneClosed,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                inbound: value.inbound?,
                lane_id: value.lane_id?,
                reason: value.reason?,
            })
        }
    }
    impl ::std::convert::From<super::MeshLaneClosed> for MeshLaneClosed {
        fn from(value: super::MeshLaneClosed) -> Self {
            Self {
                inbound: Ok(value.inbound),
                lane_id: Ok(value.lane_id),
                reason: Ok(value.reason),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct MeshLaneOpenRequest {
        class: ::std::result::Result<super::MeshLaneClass, ::std::string::String>,
        doc_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        lane_id: ::std::result::Result<u64, ::std::string::String>,
        peer: ::std::result::Result<::std::string::String, ::std::string::String>,
        protocol: ::std::result::Result<super::MeshLaneProtocol, ::std::string::String>,
    }
    impl ::std::default::Default for MeshLaneOpenRequest {
        fn default() -> Self {
            Self {
                class: Err("no value supplied for class".to_string()),
                doc_id: Ok(Default::default()),
                lane_id: Err("no value supplied for lane_id".to_string()),
                peer: Err("no value supplied for peer".to_string()),
                protocol: Err("no value supplied for protocol".to_string()),
            }
        }
    }
    impl MeshLaneOpenRequest {
        pub fn class<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::MeshLaneClass>,
            T::Error: ::std::fmt::Display,
        {
            self.class = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for class: {e}"));
            self
        }
        pub fn doc_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.doc_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for doc_id: {e}"));
            self
        }
        pub fn lane_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<u64>,
            T::Error: ::std::fmt::Display,
        {
            self.lane_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for lane_id: {e}"));
            self
        }
        pub fn peer<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.peer = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for peer: {e}"));
            self
        }
        pub fn protocol<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::MeshLaneProtocol>,
            T::Error: ::std::fmt::Display,
        {
            self.protocol = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for protocol: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<MeshLaneOpenRequest> for super::MeshLaneOpenRequest {
        type Error = super::error::ConversionError;
        fn try_from(
            value: MeshLaneOpenRequest,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                class: value.class?,
                doc_id: value.doc_id?,
                lane_id: value.lane_id?,
                peer: value.peer?,
                protocol: value.protocol?,
            })
        }
    }
    impl ::std::convert::From<super::MeshLaneOpenRequest> for MeshLaneOpenRequest {
        fn from(value: super::MeshLaneOpenRequest) -> Self {
            Self {
                class: Ok(value.class),
                doc_id: Ok(value.doc_id),
                lane_id: Ok(value.lane_id),
                peer: Ok(value.peer),
                protocol: Ok(value.protocol),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct MeshLanePeerOpened {
        class: ::std::result::Result<super::MeshLaneClass, ::std::string::String>,
        doc_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        inbound: ::std::result::Result<bool, ::std::string::String>,
        lane_id: ::std::result::Result<u64, ::std::string::String>,
        peer: ::std::result::Result<::std::string::String, ::std::string::String>,
        protocol: ::std::result::Result<super::MeshLaneProtocol, ::std::string::String>,
        whois: ::std::result::Result<
            ::std::option::Option<super::WhoIsIdentity>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for MeshLanePeerOpened {
        fn default() -> Self {
            Self {
                class: Err("no value supplied for class".to_string()),
                doc_id: Ok(Default::default()),
                inbound: Err("no value supplied for inbound".to_string()),
                lane_id: Err("no value supplied for lane_id".to_string()),
                peer: Err("no value supplied for peer".to_string()),
                protocol: Err("no value supplied for protocol".to_string()),
                whois: Ok(Default::default()),
            }
        }
    }
    impl MeshLanePeerOpened {
        pub fn class<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::MeshLaneClass>,
            T::Error: ::std::fmt::Display,
        {
            self.class = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for class: {e}"));
            self
        }
        pub fn doc_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.doc_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for doc_id: {e}"));
            self
        }
        pub fn inbound<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<bool>,
            T::Error: ::std::fmt::Display,
        {
            self.inbound = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for inbound: {e}"));
            self
        }
        pub fn lane_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<u64>,
            T::Error: ::std::fmt::Display,
        {
            self.lane_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for lane_id: {e}"));
            self
        }
        pub fn peer<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.peer = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for peer: {e}"));
            self
        }
        pub fn protocol<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::MeshLaneProtocol>,
            T::Error: ::std::fmt::Display,
        {
            self.protocol = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for protocol: {e}"));
            self
        }
        pub fn whois<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::WhoIsIdentity>>,
            T::Error: ::std::fmt::Display,
        {
            self.whois = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for whois: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<MeshLanePeerOpened> for super::MeshLanePeerOpened {
        type Error = super::error::ConversionError;
        fn try_from(
            value: MeshLanePeerOpened,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                class: value.class?,
                doc_id: value.doc_id?,
                inbound: value.inbound?,
                lane_id: value.lane_id?,
                peer: value.peer?,
                protocol: value.protocol?,
                whois: value.whois?,
            })
        }
    }
    impl ::std::convert::From<super::MeshLanePeerOpened> for MeshLanePeerOpened {
        fn from(value: super::MeshLanePeerOpened) -> Self {
            Self {
                class: Ok(value.class),
                doc_id: Ok(value.doc_id),
                inbound: Ok(value.inbound),
                lane_id: Ok(value.lane_id),
                peer: Ok(value.peer),
                protocol: Ok(value.protocol),
                whois: Ok(value.whois),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct MeshRetireResult {
        archived_to: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        retired: ::std::result::Result<bool, ::std::string::String>,
    }
    impl ::std::default::Default for MeshRetireResult {
        fn default() -> Self {
            Self {
                archived_to: Err("no value supplied for archived_to".to_string()),
                retired: Err("no value supplied for retired".to_string()),
            }
        }
    }
    impl MeshRetireResult {
        pub fn archived_to<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.archived_to = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for archived_to: {e}"));
            self
        }
        pub fn retired<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<bool>,
            T::Error: ::std::fmt::Display,
        {
            self.retired = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for retired: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<MeshRetireResult> for super::MeshRetireResult {
        type Error = super::error::ConversionError;
        fn try_from(
            value: MeshRetireResult,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                archived_to: value.archived_to?,
                retired: value.retired?,
            })
        }
    }
    impl ::std::convert::From<super::MeshRetireResult> for MeshRetireResult {
        fn from(value: super::MeshRetireResult) -> Self {
            Self {
                archived_to: Ok(value.archived_to),
                retired: Ok(value.retired),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct MeshSelfIdentity {
        device_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        device_name: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        dns_name: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        ip: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        login: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        tailscale_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for MeshSelfIdentity {
        fn default() -> Self {
            Self {
                device_id: Err("no value supplied for device_id".to_string()),
                device_name: Ok(Default::default()),
                dns_name: Ok(Default::default()),
                ip: Ok(Default::default()),
                login: Ok(Default::default()),
                tailscale_id: Ok(Default::default()),
            }
        }
    }
    impl MeshSelfIdentity {
        pub fn device_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.device_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device_id: {e}"));
            self
        }
        pub fn device_name<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.device_name = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device_name: {e}"));
            self
        }
        pub fn dns_name<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.dns_name = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for dns_name: {e}"));
            self
        }
        pub fn ip<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.ip = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for ip: {e}"));
            self
        }
        pub fn login<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.login = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for login: {e}"));
            self
        }
        pub fn tailscale_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.tailscale_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for tailscale_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<MeshSelfIdentity> for super::MeshSelfIdentity {
        type Error = super::error::ConversionError;
        fn try_from(
            value: MeshSelfIdentity,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                device_id: value.device_id?,
                device_name: value.device_name?,
                dns_name: value.dns_name?,
                ip: value.ip?,
                login: value.login?,
                tailscale_id: value.tailscale_id?,
            })
        }
    }
    impl ::std::convert::From<super::MeshSelfIdentity> for MeshSelfIdentity {
        fn from(value: super::MeshSelfIdentity) -> Self {
            Self {
                device_id: Ok(value.device_id),
                device_name: Ok(value.device_name),
                dns_name: Ok(value.dns_name),
                ip: Ok(value.ip),
                login: Ok(value.login),
                tailscale_id: Ok(value.tailscale_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct NativeHealth {
        boot_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        state: ::std::result::Result<super::NativeHealthState, ::std::string::String>,
        units: ::std::result::Result<::std::vec::Vec<super::UnitHealth>, ::std::string::String>,
    }
    impl ::std::default::Default for NativeHealth {
        fn default() -> Self {
            Self {
                boot_id: Err("no value supplied for boot_id".to_string()),
                state: Err("no value supplied for state".to_string()),
                units: Err("no value supplied for units".to_string()),
            }
        }
    }
    impl NativeHealth {
        pub fn boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for boot_id: {e}"));
            self
        }
        pub fn state<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::NativeHealthState>,
            T::Error: ::std::fmt::Display,
        {
            self.state = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for state: {e}"));
            self
        }
        pub fn units<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::UnitHealth>>,
            T::Error: ::std::fmt::Display,
        {
            self.units = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for units: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<NativeHealth> for super::NativeHealth {
        type Error = super::error::ConversionError;
        fn try_from(
            value: NativeHealth,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                boot_id: value.boot_id?,
                state: value.state?,
                units: value.units?,
            })
        }
    }
    impl ::std::convert::From<super::NativeHealth> for NativeHealth {
        fn from(value: super::NativeHealth) -> Self {
            Self {
                boot_id: Ok(value.boot_id),
                state: Ok(value.state),
                units: Ok(value.units),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ObservedState {
        boot_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        generation: ::std::result::Result<i64, ::std::string::String>,
        terminals:
            ::std::result::Result<::std::vec::Vec<super::ObservedTerminal>, ::std::string::String>,
        workers:
            ::std::result::Result<::std::vec::Vec<super::ObservedWorker>, ::std::string::String>,
    }
    impl ::std::default::Default for ObservedState {
        fn default() -> Self {
            Self {
                boot_id: Err("no value supplied for boot_id".to_string()),
                generation: Err("no value supplied for generation".to_string()),
                terminals: Err("no value supplied for terminals".to_string()),
                workers: Err("no value supplied for workers".to_string()),
            }
        }
    }
    impl ObservedState {
        pub fn boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for boot_id: {e}"));
            self
        }
        pub fn generation<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.generation = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for generation: {e}"));
            self
        }
        pub fn terminals<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::ObservedTerminal>>,
            T::Error: ::std::fmt::Display,
        {
            self.terminals = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for terminals: {e}"));
            self
        }
        pub fn workers<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::ObservedWorker>>,
            T::Error: ::std::fmt::Display,
        {
            self.workers = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for workers: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ObservedState> for super::ObservedState {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ObservedState,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                boot_id: value.boot_id?,
                generation: value.generation?,
                terminals: value.terminals?,
                workers: value.workers?,
            })
        }
    }
    impl ::std::convert::From<super::ObservedState> for ObservedState {
        fn from(value: super::ObservedState) -> Self {
            Self {
                boot_id: Ok(value.boot_id),
                generation: Ok(value.generation),
                terminals: Ok(value.terminals),
                workers: Ok(value.workers),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ObservedTerminal {
        cell: ::std::result::Result<
            ::std::option::Option<super::ObservedTerminalCell>,
            ::std::string::String,
        >,
        created_at: ::std::result::Result<::std::option::Option<i64>, ::std::string::String>,
        cwd: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        persistence: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        pid: ::std::result::Result<::std::option::Option<i64>, ::std::string::String>,
        session_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        title: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for ObservedTerminal {
        fn default() -> Self {
            Self {
                cell: Ok(Default::default()),
                created_at: Ok(Default::default()),
                cwd: Ok(Default::default()),
                persistence: Ok(Default::default()),
                pid: Ok(Default::default()),
                session_id: Err("no value supplied for session_id".to_string()),
                title: Ok(Default::default()),
            }
        }
    }
    impl ObservedTerminal {
        pub fn cell<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::ObservedTerminalCell>>,
            T::Error: ::std::fmt::Display,
        {
            self.cell = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cell: {e}"));
            self
        }
        pub fn created_at<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<i64>>,
            T::Error: ::std::fmt::Display,
        {
            self.created_at = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for created_at: {e}"));
            self
        }
        pub fn cwd<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.cwd = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cwd: {e}"));
            self
        }
        pub fn persistence<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.persistence = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for persistence: {e}"));
            self
        }
        pub fn pid<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<i64>>,
            T::Error: ::std::fmt::Display,
        {
            self.pid = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for pid: {e}"));
            self
        }
        pub fn session_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.session_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for session_id: {e}"));
            self
        }
        pub fn title<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.title = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for title: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ObservedTerminal> for super::ObservedTerminal {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ObservedTerminal,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                cell: value.cell?,
                created_at: value.created_at?,
                cwd: value.cwd?,
                persistence: value.persistence?,
                pid: value.pid?,
                session_id: value.session_id?,
                title: value.title?,
            })
        }
    }
    impl ::std::convert::From<super::ObservedTerminal> for ObservedTerminal {
        fn from(value: super::ObservedTerminal) -> Self {
            Self {
                cell: Ok(value.cell),
                created_at: Ok(value.created_at),
                cwd: Ok(value.cwd),
                persistence: Ok(value.persistence),
                pid: Ok(value.pid),
                session_id: Ok(value.session_id),
                title: Ok(value.title),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ObservedTerminalCell {
        cell_boot_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        cell_instance_id: ::std::result::Result<i64, ::std::string::String>,
        role: ::std::result::Result<
            ::std::option::Option<super::TerminalCellRole>,
            ::std::string::String,
        >,
        workload_class: ::std::result::Result<
            ::std::option::Option<super::TerminalWorkloadClass>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for ObservedTerminalCell {
        fn default() -> Self {
            Self {
                cell_boot_id: Err("no value supplied for cell_boot_id".to_string()),
                cell_instance_id: Err("no value supplied for cell_instance_id".to_string()),
                role: Ok(Default::default()),
                workload_class: Ok(Default::default()),
            }
        }
    }
    impl ObservedTerminalCell {
        pub fn cell_boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.cell_boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cell_boot_id: {e}"));
            self
        }
        pub fn cell_instance_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.cell_instance_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cell_instance_id: {e}"));
            self
        }
        pub fn role<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::TerminalCellRole>>,
            T::Error: ::std::fmt::Display,
        {
            self.role = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for role: {e}"));
            self
        }
        pub fn workload_class<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::TerminalWorkloadClass>>,
            T::Error: ::std::fmt::Display,
        {
            self.workload_class = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for workload_class: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ObservedTerminalCell> for super::ObservedTerminalCell {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ObservedTerminalCell,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                cell_boot_id: value.cell_boot_id?,
                cell_instance_id: value.cell_instance_id?,
                role: value.role?,
                workload_class: value.workload_class?,
            })
        }
    }
    impl ::std::convert::From<super::ObservedTerminalCell> for ObservedTerminalCell {
        fn from(value: super::ObservedTerminalCell) -> Self {
            Self {
                cell_boot_id: Ok(value.cell_boot_id),
                cell_instance_id: Ok(value.cell_instance_id),
                role: Ok(value.role),
                workload_class: Ok(value.workload_class),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ObservedWorker {
        id: ::std::result::Result<::std::string::String, ::std::string::String>,
        state: ::std::result::Result<super::UnitState, ::std::string::String>,
    }
    impl ::std::default::Default for ObservedWorker {
        fn default() -> Self {
            Self {
                id: Err("no value supplied for id".to_string()),
                state: Err("no value supplied for state".to_string()),
            }
        }
    }
    impl ObservedWorker {
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn state<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::UnitState>,
            T::Error: ::std::fmt::Display,
        {
            self.state = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for state: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ObservedWorker> for super::ObservedWorker {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ObservedWorker,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                id: value.id?,
                state: value.state?,
            })
        }
    }
    impl ::std::convert::From<super::ObservedWorker> for ObservedWorker {
        fn from(value: super::ObservedWorker) -> Self {
            Self {
                id: Ok(value.id),
                state: Ok(value.state),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct PairingMac {
        boot_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        mac: ::std::result::Result<::std::string::String, ::std::string::String>,
        nonce: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        ts: ::std::result::Result<i64, ::std::string::String>,
    }
    impl ::std::default::Default for PairingMac {
        fn default() -> Self {
            Self {
                boot_id: Err("no value supplied for boot_id".to_string()),
                mac: Err("no value supplied for mac".to_string()),
                nonce: Ok(Default::default()),
                ts: Err("no value supplied for ts".to_string()),
            }
        }
    }
    impl PairingMac {
        pub fn boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for boot_id: {e}"));
            self
        }
        pub fn mac<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.mac = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for mac: {e}"));
            self
        }
        pub fn nonce<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.nonce = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for nonce: {e}"));
            self
        }
        pub fn ts<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.ts = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for ts: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<PairingMac> for super::PairingMac {
        type Error = super::error::ConversionError;
        fn try_from(
            value: PairingMac,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                boot_id: value.boot_id?,
                mac: value.mac?,
                nonce: value.nonce?,
                ts: value.ts?,
            })
        }
    }
    impl ::std::convert::From<super::PairingMac> for PairingMac {
        fn from(value: super::PairingMac) -> Self {
            Self {
                boot_id: Ok(value.boot_id),
                mac: Ok(value.mac),
                nonce: Ok(value.nonce),
                ts: Ok(value.ts),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct PeerInfo {
        addresses:
            ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
        device_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        id: ::std::result::Result<::std::string::String, ::std::string::String>,
        name: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        online: ::std::result::Result<bool, ::std::string::String>,
        whois: ::std::result::Result<
            ::std::option::Option<super::WhoIsIdentity>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for PeerInfo {
        fn default() -> Self {
            Self {
                addresses: Ok(Default::default()),
                device_id: Ok(Default::default()),
                id: Err("no value supplied for id".to_string()),
                name: Ok(Default::default()),
                online: Err("no value supplied for online".to_string()),
                whois: Ok(Default::default()),
            }
        }
    }
    impl PeerInfo {
        pub fn addresses<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.addresses = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for addresses: {e}"));
            self
        }
        pub fn device_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.device_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device_id: {e}"));
            self
        }
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn name<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.name = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for name: {e}"));
            self
        }
        pub fn online<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<bool>,
            T::Error: ::std::fmt::Display,
        {
            self.online = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for online: {e}"));
            self
        }
        pub fn whois<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::WhoIsIdentity>>,
            T::Error: ::std::fmt::Display,
        {
            self.whois = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for whois: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<PeerInfo> for super::PeerInfo {
        type Error = super::error::ConversionError;
        fn try_from(value: PeerInfo) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                addresses: value.addresses?,
                device_id: value.device_id?,
                id: value.id?,
                name: value.name?,
                online: value.online?,
                whois: value.whois?,
            })
        }
    }
    impl ::std::convert::From<super::PeerInfo> for PeerInfo {
        fn from(value: super::PeerInfo) -> Self {
            Self {
                addresses: Ok(value.addresses),
                device_id: Ok(value.device_id),
                id: Ok(value.id),
                name: Ok(value.name),
                online: Ok(value.online),
                whois: Ok(value.whois),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct PluginLogProvenanceV1 {
        entry: ::std::result::Result<super::PluginLogProvenanceV1Entry, ::std::string::String>,
        id: ::std::result::Result<super::LogBoundedIdentityV1, ::std::string::String>,
        install_revision: ::std::result::Result<
            super::PluginLogProvenanceV1InstallRevision,
            ::std::string::String,
        >,
        install_source:
            ::std::result::Result<super::PluginLogProvenanceV1InstallSource, ::std::string::String>,
        trust: ::std::result::Result<super::PluginLogProvenanceV1Trust, ::std::string::String>,
        version: ::std::result::Result<super::PluginLogProvenanceV1Version, ::std::string::String>,
        window_id: ::std::result::Result<
            ::std::option::Option<super::LogBoundedIdentityV1>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for PluginLogProvenanceV1 {
        fn default() -> Self {
            Self {
                entry: Err("no value supplied for entry".to_string()),
                id: Err("no value supplied for id".to_string()),
                install_revision: Err("no value supplied for install_revision".to_string()),
                install_source: Err("no value supplied for install_source".to_string()),
                trust: Err("no value supplied for trust".to_string()),
                version: Err("no value supplied for version".to_string()),
                window_id: Ok(Default::default()),
            }
        }
    }
    impl PluginLogProvenanceV1 {
        pub fn entry<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::PluginLogProvenanceV1Entry>,
            T::Error: ::std::fmt::Display,
        {
            self.entry = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for entry: {e}"));
            self
        }
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::LogBoundedIdentityV1>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn install_revision<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::PluginLogProvenanceV1InstallRevision>,
            T::Error: ::std::fmt::Display,
        {
            self.install_revision = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for install_revision: {e}"));
            self
        }
        pub fn install_source<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::PluginLogProvenanceV1InstallSource>,
            T::Error: ::std::fmt::Display,
        {
            self.install_source = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for install_source: {e}"));
            self
        }
        pub fn trust<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::PluginLogProvenanceV1Trust>,
            T::Error: ::std::fmt::Display,
        {
            self.trust = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for trust: {e}"));
            self
        }
        pub fn version<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::PluginLogProvenanceV1Version>,
            T::Error: ::std::fmt::Display,
        {
            self.version = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for version: {e}"));
            self
        }
        pub fn window_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::LogBoundedIdentityV1>>,
            T::Error: ::std::fmt::Display,
        {
            self.window_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for window_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<PluginLogProvenanceV1> for super::PluginLogProvenanceV1 {
        type Error = super::error::ConversionError;
        fn try_from(
            value: PluginLogProvenanceV1,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                entry: value.entry?,
                id: value.id?,
                install_revision: value.install_revision?,
                install_source: value.install_source?,
                trust: value.trust?,
                version: value.version?,
                window_id: value.window_id?,
            })
        }
    }
    impl ::std::convert::From<super::PluginLogProvenanceV1> for PluginLogProvenanceV1 {
        fn from(value: super::PluginLogProvenanceV1) -> Self {
            Self {
                entry: Ok(value.entry),
                id: Ok(value.id),
                install_revision: Ok(value.install_revision),
                install_source: Ok(value.install_source),
                trust: Ok(value.trust),
                version: Ok(value.version),
                window_id: Ok(value.window_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct RpcError {
        code: ::std::result::Result<i64, ::std::string::String>,
        data: ::std::result::Result<::std::option::Option<super::ErrorData>, ::std::string::String>,
        message: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for RpcError {
        fn default() -> Self {
            Self {
                code: Err("no value supplied for code".to_string()),
                data: Ok(Default::default()),
                message: Err("no value supplied for message".to_string()),
            }
        }
    }
    impl RpcError {
        pub fn code<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.code = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for code: {e}"));
            self
        }
        pub fn data<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::ErrorData>>,
            T::Error: ::std::fmt::Display,
        {
            self.data = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for data: {e}"));
            self
        }
        pub fn message<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.message = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for message: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<RpcError> for super::RpcError {
        type Error = super::error::ConversionError;
        fn try_from(value: RpcError) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                code: value.code?,
                data: value.data?,
                message: value.message?,
            })
        }
    }
    impl ::std::convert::From<super::RpcError> for RpcError {
        fn from(value: super::RpcError) -> Self {
            Self {
                code: Ok(value.code),
                data: Ok(value.data),
                message: Ok(value.message),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct RpcFailure {
        error: ::std::result::Result<super::RpcError, ::std::string::String>,
        id: ::std::result::Result<super::RpcId, ::std::string::String>,
        jsonrpc: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for RpcFailure {
        fn default() -> Self {
            Self {
                error: Err("no value supplied for error".to_string()),
                id: Err("no value supplied for id".to_string()),
                jsonrpc: Err("no value supplied for jsonrpc".to_string()),
            }
        }
    }
    impl RpcFailure {
        pub fn error<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::RpcError>,
            T::Error: ::std::fmt::Display,
        {
            self.error = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for error: {e}"));
            self
        }
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::RpcId>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn jsonrpc<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.jsonrpc = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for jsonrpc: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<RpcFailure> for super::RpcFailure {
        type Error = super::error::ConversionError;
        fn try_from(
            value: RpcFailure,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                error: value.error?,
                id: value.id?,
                jsonrpc: value.jsonrpc?,
            })
        }
    }
    impl ::std::convert::From<super::RpcFailure> for RpcFailure {
        fn from(value: super::RpcFailure) -> Self {
            Self {
                error: Ok(value.error),
                id: Ok(value.id),
                jsonrpc: Ok(value.jsonrpc),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct RpcNotification {
        jsonrpc: ::std::result::Result<::std::string::String, ::std::string::String>,
        method: ::std::result::Result<::std::string::String, ::std::string::String>,
        params: ::std::result::Result<
            ::std::option::Option<::serde_json::Value>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for RpcNotification {
        fn default() -> Self {
            Self {
                jsonrpc: Err("no value supplied for jsonrpc".to_string()),
                method: Err("no value supplied for method".to_string()),
                params: Ok(Default::default()),
            }
        }
    }
    impl RpcNotification {
        pub fn jsonrpc<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.jsonrpc = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for jsonrpc: {e}"));
            self
        }
        pub fn method<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.method = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for method: {e}"));
            self
        }
        pub fn params<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::serde_json::Value>>,
            T::Error: ::std::fmt::Display,
        {
            self.params = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for params: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<RpcNotification> for super::RpcNotification {
        type Error = super::error::ConversionError;
        fn try_from(
            value: RpcNotification,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                jsonrpc: value.jsonrpc?,
                method: value.method?,
                params: value.params?,
            })
        }
    }
    impl ::std::convert::From<super::RpcNotification> for RpcNotification {
        fn from(value: super::RpcNotification) -> Self {
            Self {
                jsonrpc: Ok(value.jsonrpc),
                method: Ok(value.method),
                params: Ok(value.params),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct RpcRequest {
        id: ::std::result::Result<super::RpcId, ::std::string::String>,
        jsonrpc: ::std::result::Result<::std::string::String, ::std::string::String>,
        method: ::std::result::Result<::std::string::String, ::std::string::String>,
        params: ::std::result::Result<
            ::std::option::Option<::serde_json::Value>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for RpcRequest {
        fn default() -> Self {
            Self {
                id: Err("no value supplied for id".to_string()),
                jsonrpc: Err("no value supplied for jsonrpc".to_string()),
                method: Err("no value supplied for method".to_string()),
                params: Ok(Default::default()),
            }
        }
    }
    impl RpcRequest {
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::RpcId>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn jsonrpc<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.jsonrpc = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for jsonrpc: {e}"));
            self
        }
        pub fn method<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.method = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for method: {e}"));
            self
        }
        pub fn params<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::serde_json::Value>>,
            T::Error: ::std::fmt::Display,
        {
            self.params = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for params: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<RpcRequest> for super::RpcRequest {
        type Error = super::error::ConversionError;
        fn try_from(
            value: RpcRequest,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                id: value.id?,
                jsonrpc: value.jsonrpc?,
                method: value.method?,
                params: value.params?,
            })
        }
    }
    impl ::std::convert::From<super::RpcRequest> for RpcRequest {
        fn from(value: super::RpcRequest) -> Self {
            Self {
                id: Ok(value.id),
                jsonrpc: Ok(value.jsonrpc),
                method: Ok(value.method),
                params: Ok(value.params),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct RpcSuccess {
        id: ::std::result::Result<super::RpcId, ::std::string::String>,
        jsonrpc: ::std::result::Result<::std::string::String, ::std::string::String>,
        result: ::std::result::Result<
            ::std::option::Option<::serde_json::Value>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for RpcSuccess {
        fn default() -> Self {
            Self {
                id: Err("no value supplied for id".to_string()),
                jsonrpc: Err("no value supplied for jsonrpc".to_string()),
                result: Ok(Default::default()),
            }
        }
    }
    impl RpcSuccess {
        pub fn id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::RpcId>,
            T::Error: ::std::fmt::Display,
        {
            self.id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for id: {e}"));
            self
        }
        pub fn jsonrpc<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.jsonrpc = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for jsonrpc: {e}"));
            self
        }
        pub fn result<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::serde_json::Value>>,
            T::Error: ::std::fmt::Display,
        {
            self.result = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for result: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<RpcSuccess> for super::RpcSuccess {
        type Error = super::error::ConversionError;
        fn try_from(
            value: RpcSuccess,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                id: value.id?,
                jsonrpc: value.jsonrpc?,
                result: value.result?,
            })
        }
    }
    impl ::std::convert::From<super::RpcSuccess> for RpcSuccess {
        fn from(value: super::RpcSuccess) -> Self {
            Self {
                id: Ok(value.id),
                jsonrpc: Ok(value.jsonrpc),
                result: Ok(value.result),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ServeConfig {
        allow: ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
        listen_port: ::std::result::Result<
            ::std::option::Option<::std::num::NonZeroU64>,
            ::std::string::String,
        >,
        name: ::std::result::Result<::std::string::String, ::std::string::String>,
        path_secret: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        preview_dir: ::std::result::Result<
            ::std::option::Option<super::ServeConfigPreviewDir>,
            ::std::string::String,
        >,
        serve_id: ::std::result::Result<
            ::std::option::Option<super::ServeConfigServeId>,
            ::std::string::String,
        >,
        target: ::std::result::Result<super::ServeTarget, ::std::string::String>,
        tls: ::std::result::Result<::std::option::Option<bool>, ::std::string::String>,
    }
    impl ::std::default::Default for ServeConfig {
        fn default() -> Self {
            Self {
                allow: Ok(Default::default()),
                listen_port: Ok(Default::default()),
                name: Err("no value supplied for name".to_string()),
                path_secret: Ok(Default::default()),
                preview_dir: Ok(Default::default()),
                serve_id: Ok(Default::default()),
                target: Err("no value supplied for target".to_string()),
                tls: Ok(Default::default()),
            }
        }
    }
    impl ServeConfig {
        pub fn allow<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.allow = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for allow: {e}"));
            self
        }
        pub fn listen_port<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::num::NonZeroU64>>,
            T::Error: ::std::fmt::Display,
        {
            self.listen_port = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for listen_port: {e}"));
            self
        }
        pub fn name<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.name = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for name: {e}"));
            self
        }
        pub fn path_secret<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.path_secret = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for path_secret: {e}"));
            self
        }
        pub fn preview_dir<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::ServeConfigPreviewDir>>,
            T::Error: ::std::fmt::Display,
        {
            self.preview_dir = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for preview_dir: {e}"));
            self
        }
        pub fn serve_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::ServeConfigServeId>>,
            T::Error: ::std::fmt::Display,
        {
            self.serve_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for serve_id: {e}"));
            self
        }
        pub fn target<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::ServeTarget>,
            T::Error: ::std::fmt::Display,
        {
            self.target = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for target: {e}"));
            self
        }
        pub fn tls<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<bool>>,
            T::Error: ::std::fmt::Display,
        {
            self.tls = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for tls: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ServeConfig> for super::ServeConfig {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ServeConfig,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                allow: value.allow?,
                listen_port: value.listen_port?,
                name: value.name?,
                path_secret: value.path_secret?,
                preview_dir: value.preview_dir?,
                serve_id: value.serve_id?,
                target: value.target?,
                tls: value.tls?,
            })
        }
    }
    impl ::std::convert::From<super::ServeConfig> for ServeConfig {
        fn from(value: super::ServeConfig) -> Self {
            Self {
                allow: Ok(value.allow),
                listen_port: Ok(value.listen_port),
                name: Ok(value.name),
                path_secret: Ok(value.path_secret),
                preview_dir: Ok(value.preview_dir),
                serve_id: Ok(value.serve_id),
                target: Ok(value.target),
                tls: Ok(value.tls),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ServeEntry {
        allow: ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
        error: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        listen_port: ::std::result::Result<::std::num::NonZeroU64, ::std::string::String>,
        name: ::std::result::Result<::std::string::String, ::std::string::String>,
        serve_id: ::std::result::Result<super::ServeEntryServeId, ::std::string::String>,
        status: ::std::result::Result<
            ::std::option::Option<super::ServeEntryStatus>,
            ::std::string::String,
        >,
        target: ::std::result::Result<super::ServeTarget, ::std::string::String>,
        tls: ::std::result::Result<::std::option::Option<bool>, ::std::string::String>,
        url: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for ServeEntry {
        fn default() -> Self {
            Self {
                allow: Ok(Default::default()),
                error: Ok(Default::default()),
                listen_port: Err("no value supplied for listen_port".to_string()),
                name: Err("no value supplied for name".to_string()),
                serve_id: Err("no value supplied for serve_id".to_string()),
                status: Ok(Default::default()),
                target: Err("no value supplied for target".to_string()),
                tls: Ok(Default::default()),
                url: Err("no value supplied for url".to_string()),
            }
        }
    }
    impl ServeEntry {
        pub fn allow<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.allow = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for allow: {e}"));
            self
        }
        pub fn error<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.error = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for error: {e}"));
            self
        }
        pub fn listen_port<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::num::NonZeroU64>,
            T::Error: ::std::fmt::Display,
        {
            self.listen_port = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for listen_port: {e}"));
            self
        }
        pub fn name<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.name = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for name: {e}"));
            self
        }
        pub fn serve_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::ServeEntryServeId>,
            T::Error: ::std::fmt::Display,
        {
            self.serve_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for serve_id: {e}"));
            self
        }
        pub fn status<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::ServeEntryStatus>>,
            T::Error: ::std::fmt::Display,
        {
            self.status = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for status: {e}"));
            self
        }
        pub fn target<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::ServeTarget>,
            T::Error: ::std::fmt::Display,
        {
            self.target = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for target: {e}"));
            self
        }
        pub fn tls<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<bool>>,
            T::Error: ::std::fmt::Display,
        {
            self.tls = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for tls: {e}"));
            self
        }
        pub fn url<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.url = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for url: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<ServeEntry> for super::ServeEntry {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ServeEntry,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                allow: value.allow?,
                error: value.error?,
                listen_port: value.listen_port?,
                name: value.name?,
                serve_id: value.serve_id?,
                status: value.status?,
                target: value.target?,
                tls: value.tls?,
                url: value.url?,
            })
        }
    }
    impl ::std::convert::From<super::ServeEntry> for ServeEntry {
        fn from(value: super::ServeEntry) -> Self {
            Self {
                allow: Ok(value.allow),
                error: Ok(value.error),
                listen_port: Ok(value.listen_port),
                name: Ok(value.name),
                serve_id: Ok(value.serve_id),
                status: Ok(value.status),
                target: Ok(value.target),
                tls: Ok(value.tls),
                url: Ok(value.url),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct StoreSnapshot {
        slices: ::std::result::Result<
            ::serde_json::Map<::std::string::String, ::serde_json::Value>,
            ::std::string::String,
        >,
        store_id: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for StoreSnapshot {
        fn default() -> Self {
            Self {
                slices: Err("no value supplied for slices".to_string()),
                store_id: Err("no value supplied for store_id".to_string()),
            }
        }
    }
    impl StoreSnapshot {
        pub fn slices<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<
                ::serde_json::Map<::std::string::String, ::serde_json::Value>,
            >,
            T::Error: ::std::fmt::Display,
        {
            self.slices = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for slices: {e}"));
            self
        }
        pub fn store_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.store_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for store_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<StoreSnapshot> for super::StoreSnapshot {
        type Error = super::error::ConversionError;
        fn try_from(
            value: StoreSnapshot,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                slices: value.slices?,
                store_id: value.store_id?,
            })
        }
    }
    impl ::std::convert::From<super::StoreSnapshot> for StoreSnapshot {
        fn from(value: super::StoreSnapshot) -> Self {
            Self {
                slices: Ok(value.slices),
                store_id: Ok(value.store_id),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct TerminalEndpoints {
        auth_token: ::std::result::Result<::std::string::String, ::std::string::String>,
        control_socket: ::std::result::Result<::std::string::String, ::std::string::String>,
        frame_socket: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for TerminalEndpoints {
        fn default() -> Self {
            Self {
                auth_token: Err("no value supplied for auth_token".to_string()),
                control_socket: Err("no value supplied for control_socket".to_string()),
                frame_socket: Err("no value supplied for frame_socket".to_string()),
            }
        }
    }
    impl TerminalEndpoints {
        pub fn auth_token<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.auth_token = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for auth_token: {e}"));
            self
        }
        pub fn control_socket<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.control_socket = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for control_socket: {e}"));
            self
        }
        pub fn frame_socket<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.frame_socket = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for frame_socket: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<TerminalEndpoints> for super::TerminalEndpoints {
        type Error = super::error::ConversionError;
        fn try_from(
            value: TerminalEndpoints,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                auth_token: value.auth_token?,
                control_socket: value.control_socket?,
                frame_socket: value.frame_socket?,
            })
        }
    }
    impl ::std::convert::From<super::TerminalEndpoints> for TerminalEndpoints {
        fn from(value: super::TerminalEndpoints) -> Self {
            Self {
                auth_token: Ok(value.auth_token),
                control_socket: Ok(value.control_socket),
                frame_socket: Ok(value.frame_socket),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct TerminalRouteCell {
        cell_boot_id: ::std::result::Result<::std::string::String, ::std::string::String>,
        cell_instance_id: ::std::result::Result<i64, ::std::string::String>,
        doors: ::std::result::Result<
            ::std::option::Option<super::CellEndpointSet>,
            ::std::string::String,
        >,
        endpoints: ::std::result::Result<super::TerminalEndpoints, ::std::string::String>,
        grant_key: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        grant_key_generation:
            ::std::result::Result<::std::option::Option<i64>, ::std::string::String>,
        pid: ::std::result::Result<i64, ::std::string::String>,
        role: ::std::result::Result<
            ::std::option::Option<super::TerminalCellRole>,
            ::std::string::String,
        >,
        token_generation: ::std::result::Result<i64, ::std::string::String>,
        workload_class: ::std::result::Result<
            ::std::option::Option<super::TerminalWorkloadClass>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for TerminalRouteCell {
        fn default() -> Self {
            Self {
                cell_boot_id: Err("no value supplied for cell_boot_id".to_string()),
                cell_instance_id: Err("no value supplied for cell_instance_id".to_string()),
                doors: Ok(Default::default()),
                endpoints: Err("no value supplied for endpoints".to_string()),
                grant_key: Ok(Default::default()),
                grant_key_generation: Ok(Default::default()),
                pid: Err("no value supplied for pid".to_string()),
                role: Ok(Default::default()),
                token_generation: Err("no value supplied for token_generation".to_string()),
                workload_class: Ok(Default::default()),
            }
        }
    }
    impl TerminalRouteCell {
        pub fn cell_boot_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.cell_boot_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cell_boot_id: {e}"));
            self
        }
        pub fn cell_instance_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.cell_instance_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cell_instance_id: {e}"));
            self
        }
        pub fn doors<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::CellEndpointSet>>,
            T::Error: ::std::fmt::Display,
        {
            self.doors = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for doors: {e}"));
            self
        }
        pub fn endpoints<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::TerminalEndpoints>,
            T::Error: ::std::fmt::Display,
        {
            self.endpoints = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for endpoints: {e}"));
            self
        }
        pub fn grant_key<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.grant_key = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for grant_key: {e}"));
            self
        }
        pub fn grant_key_generation<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<i64>>,
            T::Error: ::std::fmt::Display,
        {
            self.grant_key_generation = value.try_into().map_err(|e| {
                format!("error converting supplied value for grant_key_generation: {e}")
            });
            self
        }
        pub fn pid<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.pid = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for pid: {e}"));
            self
        }
        pub fn role<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::TerminalCellRole>>,
            T::Error: ::std::fmt::Display,
        {
            self.role = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for role: {e}"));
            self
        }
        pub fn token_generation<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.token_generation = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for token_generation: {e}"));
            self
        }
        pub fn workload_class<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<super::TerminalWorkloadClass>>,
            T::Error: ::std::fmt::Display,
        {
            self.workload_class = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for workload_class: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<TerminalRouteCell> for super::TerminalRouteCell {
        type Error = super::error::ConversionError;
        fn try_from(
            value: TerminalRouteCell,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                cell_boot_id: value.cell_boot_id?,
                cell_instance_id: value.cell_instance_id?,
                doors: value.doors?,
                endpoints: value.endpoints?,
                grant_key: value.grant_key?,
                grant_key_generation: value.grant_key_generation?,
                pid: value.pid?,
                role: value.role?,
                token_generation: value.token_generation?,
                workload_class: value.workload_class?,
            })
        }
    }
    impl ::std::convert::From<super::TerminalRouteCell> for TerminalRouteCell {
        fn from(value: super::TerminalRouteCell) -> Self {
            Self {
                cell_boot_id: Ok(value.cell_boot_id),
                cell_instance_id: Ok(value.cell_instance_id),
                doors: Ok(value.doors),
                endpoints: Ok(value.endpoints),
                grant_key: Ok(value.grant_key),
                grant_key_generation: Ok(value.grant_key_generation),
                pid: Ok(value.pid),
                role: Ok(value.role),
                token_generation: Ok(value.token_generation),
                workload_class: Ok(value.workload_class),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct TerminalRouteSnapshot {
        cells:
            ::std::result::Result<::std::vec::Vec<super::TerminalRouteCell>, ::std::string::String>,
        revision: ::std::result::Result<i64, ::std::string::String>,
    }
    impl ::std::default::Default for TerminalRouteSnapshot {
        fn default() -> Self {
            Self {
                cells: Err("no value supplied for cells".to_string()),
                revision: Err("no value supplied for revision".to_string()),
            }
        }
    }
    impl TerminalRouteSnapshot {
        pub fn cells<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::vec::Vec<super::TerminalRouteCell>>,
            T::Error: ::std::fmt::Display,
        {
            self.cells = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for cells: {e}"));
            self
        }
        pub fn revision<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<i64>,
            T::Error: ::std::fmt::Display,
        {
            self.revision = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for revision: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<TerminalRouteSnapshot> for super::TerminalRouteSnapshot {
        type Error = super::error::ConversionError;
        fn try_from(
            value: TerminalRouteSnapshot,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                cells: value.cells?,
                revision: value.revision?,
            })
        }
    }
    impl ::std::convert::From<super::TerminalRouteSnapshot> for TerminalRouteSnapshot {
        fn from(value: super::TerminalRouteSnapshot) -> Self {
            Self {
                cells: Ok(value.cells),
                revision: Ok(value.revision),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct UnavailableDetails {
        device: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        progress: ::std::result::Result<::std::option::Option<f64>, ::std::string::String>,
        service: ::std::result::Result<::std::string::String, ::std::string::String>,
        state: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for UnavailableDetails {
        fn default() -> Self {
            Self {
                device: Ok(Default::default()),
                progress: Ok(Default::default()),
                service: Err("no value supplied for service".to_string()),
                state: Err("no value supplied for state".to_string()),
            }
        }
    }
    impl UnavailableDetails {
        pub fn device<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.device = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device: {e}"));
            self
        }
        pub fn progress<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<f64>>,
            T::Error: ::std::fmt::Display,
        {
            self.progress = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for progress: {e}"));
            self
        }
        pub fn service<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.service = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for service: {e}"));
            self
        }
        pub fn state<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.state = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for state: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<UnavailableDetails> for super::UnavailableDetails {
        type Error = super::error::ConversionError;
        fn try_from(
            value: UnavailableDetails,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                device: value.device?,
                progress: value.progress?,
                service: value.service?,
                state: value.state?,
            })
        }
    }
    impl ::std::convert::From<super::UnavailableDetails> for UnavailableDetails {
        fn from(value: super::UnavailableDetails) -> Self {
            Self {
                device: Ok(value.device),
                progress: Ok(value.progress),
                service: Ok(value.service),
                state: Ok(value.state),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct UnitHealth {
        auth_url: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        detail: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        state: ::std::result::Result<super::UnitState, ::std::string::String>,
        unit: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for UnitHealth {
        fn default() -> Self {
            Self {
                auth_url: Ok(Default::default()),
                detail: Ok(Default::default()),
                state: Err("no value supplied for state".to_string()),
                unit: Err("no value supplied for unit".to_string()),
            }
        }
    }
    impl UnitHealth {
        pub fn auth_url<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.auth_url = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for auth_url: {e}"));
            self
        }
        pub fn detail<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.detail = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for detail: {e}"));
            self
        }
        pub fn state<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<super::UnitState>,
            T::Error: ::std::fmt::Display,
        {
            self.state = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for state: {e}"));
            self
        }
        pub fn unit<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.unit = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for unit: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<UnitHealth> for super::UnitHealth {
        type Error = super::error::ConversionError;
        fn try_from(
            value: UnitHealth,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                auth_url: value.auth_url?,
                detail: value.detail?,
                state: value.state?,
                unit: value.unit?,
            })
        }
    }
    impl ::std::convert::From<super::UnitHealth> for UnitHealth {
        fn from(value: super::UnitHealth) -> Self {
            Self {
                auth_url: Ok(value.auth_url),
                detail: Ok(value.detail),
                state: Ok(value.state),
                unit: Ok(value.unit),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct WhoIsIdentity {
        device_name: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
        login: ::std::result::Result<::std::string::String, ::std::string::String>,
        tailscale_id: ::std::result::Result<
            ::std::option::Option<::std::string::String>,
            ::std::string::String,
        >,
    }
    impl ::std::default::Default for WhoIsIdentity {
        fn default() -> Self {
            Self {
                device_name: Ok(Default::default()),
                login: Err("no value supplied for login".to_string()),
                tailscale_id: Ok(Default::default()),
            }
        }
    }
    impl WhoIsIdentity {
        pub fn device_name<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.device_name = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for device_name: {e}"));
            self
        }
        pub fn login<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::string::String>,
            T::Error: ::std::fmt::Display,
        {
            self.login = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for login: {e}"));
            self
        }
        pub fn tailscale_id<T>(mut self, value: T) -> Self
        where
            T: ::std::convert::TryInto<::std::option::Option<::std::string::String>>,
            T::Error: ::std::fmt::Display,
        {
            self.tailscale_id = value
                .try_into()
                .map_err(|e| format!("error converting supplied value for tailscale_id: {e}"));
            self
        }
    }
    impl ::std::convert::TryFrom<WhoIsIdentity> for super::WhoIsIdentity {
        type Error = super::error::ConversionError;
        fn try_from(
            value: WhoIsIdentity,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                device_name: value.device_name?,
                login: value.login?,
                tailscale_id: value.tailscale_id?,
            })
        }
    }
    impl ::std::convert::From<super::WhoIsIdentity> for WhoIsIdentity {
        fn from(value: super::WhoIsIdentity) -> Self {
            Self {
                device_name: Ok(value.device_name),
                login: Ok(value.login),
                tailscale_id: Ok(value.tailscale_id),
            }
        }
    }
}
