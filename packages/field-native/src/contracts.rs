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
#[doc = "    \"TIMEOUT\","]
#[doc = "    \"INCOMPATIBLE\","]
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
    #[serde(rename = "TIMEOUT")]
    Timeout,
    #[serde(rename = "INCOMPATIBLE")]
    Incompatible,
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
            Self::Timeout => f.write_str("TIMEOUT"),
            Self::Incompatible => f.write_str("INCOMPATIBLE"),
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
            "TIMEOUT" => Ok(Self::Timeout),
            "INCOMPATIBLE" => Ok(Self::Incompatible),
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
#[doc = "    \"minCompatible\": {"]
#[doc = "      \"$ref\": \"#/definitions/SemverString\""]
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
    #[serde(rename = "minCompatible")]
    pub min_compatible: SemverString,
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
#[doc = "    \"serverKind\": {"]
#[doc = "      \"$ref\": \"#/definitions/ServerKind\""]
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
    #[serde(rename = "serverKind")]
    pub server_kind: ServerKind,
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
#[doc = "    \"name\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"target\": {"]
#[doc = "      \"$ref\": \"#/definitions/ServeTarget\""]
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
    pub name: ::std::string::String,
    pub target: ServeTarget,
}
impl ServeConfig {
    pub fn builder() -> builder::ServeConfig {
        Default::default()
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
#[doc = "    \"name\","]
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
#[doc = "    \"name\": {"]
#[doc = "      \"type\": \"string\""]
#[doc = "    },"]
#[doc = "    \"target\": {"]
#[doc = "      \"$ref\": \"#/definitions/ServeTarget\""]
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
    pub name: ::std::string::String,
    pub target: ServeTarget,
    pub url: ::std::string::String,
}
impl ServeEntry {
    pub fn builder() -> builder::ServeEntry {
        Default::default()
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
    },
    Variant1 {
        kind: ::std::string::String,
        path: ::std::string::String,
    },
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
#[doc = "    \"crashed\""]
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
}
impl ::std::fmt::Display for UnitState {
    fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
        match *self {
            Self::Starting => f.write_str("starting"),
            Self::Up => f.write_str("up"),
            Self::Degraded => f.write_str("degraded"),
            Self::Crashed => f.write_str("crashed"),
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
    pub struct DesiredState {
        generation: ::std::result::Result<i64, ::std::string::String>,
        mesh_config:
            ::std::result::Result<::std::option::Option<super::MeshConfig>, ::std::string::String>,
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
        min_compatible: ::std::result::Result<super::SemverString, ::std::string::String>,
    }
    impl ::std::default::Default for Hello {
        fn default() -> Self {
            Self {
                client_kind: Err("no value supplied for client_kind".to_string()),
                contracts_version: Err("no value supplied for contracts_version".to_string()),
                credential: Ok(Default::default()),
                min_compatible: Err("no value supplied for min_compatible".to_string()),
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
    }
    impl ::std::convert::TryFrom<Hello> for super::Hello {
        type Error = super::error::ConversionError;
        fn try_from(value: Hello) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                client_kind: value.client_kind?,
                contracts_version: value.contracts_version?,
                credential: value.credential?,
                min_compatible: value.min_compatible?,
            })
        }
    }
    impl ::std::convert::From<super::Hello> for Hello {
        fn from(value: super::Hello) -> Self {
            Self {
                client_kind: Ok(value.client_kind),
                contracts_version: Ok(value.contracts_version),
                credential: Ok(value.credential),
                min_compatible: Ok(value.min_compatible),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct HelloAck {
        contracts_version: ::std::result::Result<super::SemverString, ::std::string::String>,
        granted_scopes:
            ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
        server_kind: ::std::result::Result<super::ServerKind, ::std::string::String>,
    }
    impl ::std::default::Default for HelloAck {
        fn default() -> Self {
            Self {
                contracts_version: Err("no value supplied for contracts_version".to_string()),
                granted_scopes: Err("no value supplied for granted_scopes".to_string()),
                server_kind: Err("no value supplied for server_kind".to_string()),
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
    }
    impl ::std::convert::TryFrom<HelloAck> for super::HelloAck {
        type Error = super::error::ConversionError;
        fn try_from(value: HelloAck) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                contracts_version: value.contracts_version?,
                granted_scopes: value.granted_scopes?,
                server_kind: value.server_kind?,
            })
        }
    }
    impl ::std::convert::From<super::HelloAck> for HelloAck {
        fn from(value: super::HelloAck) -> Self {
            Self {
                contracts_version: Ok(value.contracts_version),
                granted_scopes: Ok(value.granted_scopes),
                server_kind: Ok(value.server_kind),
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
        ts: ::std::result::Result<i64, ::std::string::String>,
    }
    impl ::std::default::Default for PairingMac {
        fn default() -> Self {
            Self {
                boot_id: Err("no value supplied for boot_id".to_string()),
                mac: Err("no value supplied for mac".to_string()),
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
                ts: value.ts?,
            })
        }
    }
    impl ::std::convert::From<super::PairingMac> for PairingMac {
        fn from(value: super::PairingMac) -> Self {
            Self {
                boot_id: Ok(value.boot_id),
                mac: Ok(value.mac),
                ts: Ok(value.ts),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct PeerInfo {
        addresses:
            ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
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
                id: Ok(value.id),
                name: Ok(value.name),
                online: Ok(value.online),
                whois: Ok(value.whois),
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
        name: ::std::result::Result<::std::string::String, ::std::string::String>,
        target: ::std::result::Result<super::ServeTarget, ::std::string::String>,
    }
    impl ::std::default::Default for ServeConfig {
        fn default() -> Self {
            Self {
                allow: Ok(Default::default()),
                name: Err("no value supplied for name".to_string()),
                target: Err("no value supplied for target".to_string()),
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
    }
    impl ::std::convert::TryFrom<ServeConfig> for super::ServeConfig {
        type Error = super::error::ConversionError;
        fn try_from(
            value: ServeConfig,
        ) -> ::std::result::Result<Self, super::error::ConversionError> {
            Ok(Self {
                allow: value.allow?,
                name: value.name?,
                target: value.target?,
            })
        }
    }
    impl ::std::convert::From<super::ServeConfig> for ServeConfig {
        fn from(value: super::ServeConfig) -> Self {
            Self {
                allow: Ok(value.allow),
                name: Ok(value.name),
                target: Ok(value.target),
            }
        }
    }
    #[derive(Clone, Debug)]
    pub struct ServeEntry {
        allow: ::std::result::Result<::std::vec::Vec<::std::string::String>, ::std::string::String>,
        name: ::std::result::Result<::std::string::String, ::std::string::String>,
        target: ::std::result::Result<super::ServeTarget, ::std::string::String>,
        url: ::std::result::Result<::std::string::String, ::std::string::String>,
    }
    impl ::std::default::Default for ServeEntry {
        fn default() -> Self {
            Self {
                allow: Ok(Default::default()),
                name: Err("no value supplied for name".to_string()),
                target: Err("no value supplied for target".to_string()),
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
                name: value.name?,
                target: value.target?,
                url: value.url?,
            })
        }
    }
    impl ::std::convert::From<super::ServeEntry> for ServeEntry {
        fn from(value: super::ServeEntry) -> Self {
            Self {
                allow: Ok(value.allow),
                name: Ok(value.name),
                target: Ok(value.target),
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
