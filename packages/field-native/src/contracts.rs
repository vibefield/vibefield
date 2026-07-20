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
#[doc = r" Types for composing complex structures."]
pub mod builder {
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
}
