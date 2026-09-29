import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Children, cloneElement, isValidElement, useId, type ReactElement } from "react";
import { PublicSurface } from "@/components/public/PublicSurface";

export function AuthField({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const generatedId = useId();
  let fieldId = htmlFor;
  let content = children;

  if (!fieldId && Children.count(children) === 1) {
    const only = Children.only(children);
    if (
      isValidElement<React.InputHTMLAttributes<HTMLInputElement>>(only) &&
      only.type === AuthInput
    ) {
      fieldId = only.props.id ?? generatedId;
      content = cloneElement(only as ReactElement<React.InputHTMLAttributes<HTMLInputElement>>, {
        id: fieldId,
      });
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="ui-auth-label" htmlFor={fieldId}>
        {label}
      </label>
      {content}
    </div>
  );
}

export function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`ui-auth-input ${props.className ?? ""}`} style={props.style} />
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return <div className="ui-auth-card">{children}</div>;
}

export function AuthHeading({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-10 text-center">
      {badge}
      <h1 className="ui-auth-title">{title}</h1>
      <p className="ui-auth-subtitle">{description}</p>
    </div>
  );
}

export function AuthSubmitButton({
  loading,
  disabled,
  label,
  loadingLabel,
  onClick,
}: {
  loading?: boolean;
  disabled?: boolean;
  label: string;
  loadingLabel?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={loading || disabled}
      className="ui-auth-submit-btn"
    >
      {loading && loadingLabel ? loadingLabel : label}
    </button>
  );
}

export function AuthShell({
  children,
  navRight,
}: {
  children: React.ReactNode;
  navRight?: React.ReactNode;
}) {
  return (
    <PublicSurface right={navRight} showNav={false}>
      {/* No feedback launcher on an auth wall: every slot near its corner is
          a button, and the one free spot at 390px was the divider rule beside
          "or sign in" (seen live, 2026-09-29). The person here has nothing to
          report yet; the launcher returns on every page after this one. */}
      <main className="ui-auth-main" data-fc-place="hidden">
        <div className="ui-auth-container">{children}</div>
      </main>
    </PublicSurface>
  );
}

export function AuthIconBadge({ children }: { children: React.ReactNode }) {
  return <div className="ui-auth-icon-badge">{children}</div>;
}

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="ui-auth-divider-line" />
      <span className="ui-auth-divider-label">{label}</span>
      <div className="ui-auth-divider-line" />
    </div>
  );
}

export function AuthFooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="ui-auth-footer">
      <Link href={href} className="ui-auth-footer-link">
        {children}
      </Link>
    </p>
  );
}

export function AuthSecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`ui-auth-secondary-btn ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function AuthProgressBar({ activeStep, steps = 3 }: { activeStep: number; steps?: number }) {
  return (
    <div className="ui-auth-progress-row">
      {Array.from({ length: steps }, (_, i) => (
        <div
          key={i}
          className={`ui-auth-progress-segment${i <= activeStep ? " ui-auth-progress-segment-active" : ""}`}
        />
      ))}
    </div>
  );
}

export function AuthPrefixField({
  prefix,
  value,
  onChange,
  onEnter,
  placeholder,
  id,
}: {
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  id?: string;
}) {
  return (
    <div className="ui-auth-prefix-field">
      <span className="ui-auth-prefix-label">{prefix}</span>
      <input
        id={id}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        className="ui-auth-prefix-input"
      />
    </div>
  );
}

export function AuthLoadingCenter({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div className="ui-auth-loading">
      <Loader2 className={size === "sm" ? "ui-auth-spinner-sm" : "ui-auth-spinner"} />
    </div>
  );
}

export function AuthModeTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="ui-auth-mode-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={
            active === tab.id ? "ui-auth-mode-tab ui-auth-mode-tab-active" : "ui-auth-mode-tab"
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The fields every account-creating form asks for, in the order both asked for
 * them. /setup (the first admin) and SignUpForm (everyone after) had this block
 * written out twice, identical down to the placeholders and autocomplete hints
 * — which matters more than it looks: a password manager keys off those, so a
 * drift between the two forms is a drift in whether saved credentials work.
 *
 * The only difference was that sign-up also asks for an email. Pass `email` to
 * get that field; omit it and it is not rendered.
 */
export function CreateAccountFields({
  name,
  onName,
  namePlaceholder,
  email,
  onEmail,
  password,
  onPassword,
  confirm,
  onConfirm,
}: {
  name: string;
  onName: (value: string) => void;
  namePlaceholder: string;
  email?: string;
  onEmail?: (value: string) => void;
  password: string;
  onPassword: (value: string) => void;
  confirm: string;
  onConfirm: (value: string) => void;
}) {
  return (
    <>
      <AuthField label="Your name">
        <AuthInput
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder={namePlaceholder}
          autoComplete="name"
          required
        />
      </AuthField>

      {email !== undefined && onEmail && (
        <AuthField label="Email">
          <AuthInput
            type="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </AuthField>
      )}

      <AuthField label="Password">
        <AuthInput
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
        />
      </AuthField>

      <AuthField label="Confirm password">
        <AuthInput
          type="password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          placeholder="Repeat password"
          autoComplete="new-password"
          required
        />
      </AuthField>
    </>
  );
}
