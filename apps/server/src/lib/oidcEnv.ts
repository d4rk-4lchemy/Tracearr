export const oidcEnv = {
  issuer: process.env.OIDC_ISSUER_URL,
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
};

/** True only when all three required OIDC env vars are set. Config-gates the genericOAuth plugin. */
export const oidcConfigured = !!(oidcEnv.issuer && oidcEnv.clientId && oidcEnv.clientSecret);

export const oidcDiscoveryUrl = `${(oidcEnv.issuer ?? '').replace(/\/$/, '')}/.well-known/openid-configuration`;
