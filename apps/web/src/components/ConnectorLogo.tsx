import type { SVGProps } from 'react';

// Inline brand-logotyper för Mistrals built-ins och vanliga MCP-connectors.
// CLAUDE.md § 7: Inga externa CDN-anrop — alla SVG-paths är inline här.
// Källa: Simple Icons (CC0 1.0), 24x24-viewbox, fill=currentColor.

interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function Svg({ size = 20, children, ...rest }: LogoProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

// ── Built-ins ───────────────────────────────────────────────────────────

function WebSearchLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 2c4.418 0 8 3.582 8 8 0 .855-.137 1.678-.389 2.451l-1.93-1.93a4 4 0 1 0-5.7 5.7l1.93 1.93A8 8 0 0 1 12 20c-4.418 0-8-3.582-8-8s3.582-8 8-8z" />
      <path d="M15.5 14.5l5.5 5.5-1.5 1.5-5.5-5.5z" />
    </Svg>
  );
}

function CodeInterpreterLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
    </Svg>
  );
}

function ImageGenerationLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    </Svg>
  );
}

function DocumentLibraryLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M19 3H5c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zM8 17H6V9h2v8zm4 0h-2V7h2v10zm4 0h-2v-5h2v5z" />
    </Svg>
  );
}

// ── MCP-connectors (kända providers) ────────────────────────────────────

function SlackLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </Svg>
  );
}

function GithubLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </Svg>
  );
}

function GoogleLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </Svg>
  );
}

function MicrosoftLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" />
    </Svg>
  );
}

function NotionLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.727l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </Svg>
  );
}

function LinearLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M.403 13.795c-.108-.484.51-.78.86-.43L10.635 22.74c.349.348.053.967-.43.86C5.255 22.439 1.244 18.404.403 13.795zM.025 9.16c-.018.16.04.319.155.435l14.226 14.226c.116.115.275.173.434.155 1.07-.117 2.099-.358 3.074-.71.396-.142.515-.642.221-.937L1.673 5.867c-.295-.295-.795-.176-.937.221-.353.975-.595 2.005-.71 3.073zm2.314-6.348c-.27.317-.252.788.043 1.083l17.737 17.732c.295.295.766.314 1.083.043.715-.612 1.378-1.273 1.99-1.988.27-.317.252-.788-.043-1.083L5.41.953c-.295-.295-.766-.314-1.083-.043-.715.612-1.376 1.275-1.988 1.989zM12.012 0c-1.31 0-2.57.21-3.751.598-.474.156-.617.755-.265 1.107l14.302 14.302c.352.352.951.21 1.107-.265a11.95 11.95 0 0 0 .598-3.751C24.003 5.367 18.634 0 12.012 0z" />
    </Svg>
  );
}

// ── Mappning ────────────────────────────────────────────────────────────

const MCP_NAME_PATTERNS: Array<{
  match: RegExp;
  Logo: (props: LogoProps) => React.JSX.Element;
}> = [
  { match: /slack/i, Logo: SlackLogo },
  { match: /github|gh\s|git\b/i, Logo: GithubLogo },
  { match: /outlook|microsoft|m365|teams|sharepoint|onedrive|office\s?365/i, Logo: MicrosoftLogo },
  { match: /google|gdrive|gmail|drive\b|calendar/i, Logo: GoogleLogo },
  { match: /notion/i, Logo: NotionLogo },
  { match: /linear/i, Logo: LinearLogo }
];

function GenericMcpLogo(props: LogoProps) {
  return (
    <Svg {...props}>
      <path d="M4 9h2v6H4v3a1 1 0 0 1-1 1H2v-2H1v-2h1V8H1V6h1V4h1a1 1 0 0 1 1 1v4zm14 6h2V9h-2V5a1 1 0 0 1 1-1h1v2h1v2h-1v8h1v2h-1v2h-1a1 1 0 0 1-1-1v-3z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export interface ConnectorLogoProps extends LogoProps {
  kind: 'builtin' | 'mcp';
  connectorId: string;
  connectorName?: string;
}

export function ConnectorLogo({
  kind,
  connectorId,
  connectorName,
  ...rest
}: ConnectorLogoProps) {
  if (kind === 'builtin') {
    switch (connectorId) {
      case 'web_search':
        return <WebSearchLogo {...rest} />;
      case 'code_interpreter':
        return <CodeInterpreterLogo {...rest} />;
      case 'image_generation':
        return <ImageGenerationLogo {...rest} />;
      case 'document_library':
        return <DocumentLibraryLogo {...rest} />;
    }
  }

  // MCP: matcha mot kända providers via namn / id.
  const hay = `${connectorName ?? ''} ${connectorId}`;
  for (const { match, Logo } of MCP_NAME_PATTERNS) {
    if (match.test(hay)) return <Logo {...rest} />;
  }
  return <GenericMcpLogo {...rest} />;
}
