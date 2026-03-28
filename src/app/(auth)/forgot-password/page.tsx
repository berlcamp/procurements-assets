export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-4 p-8">
        <h1 className="text-2xl font-bold text-center">Forgot Password</h1>
        <p className="text-muted-foreground text-center text-sm">
          Enter your email to receive a password reset link.
        </p>
        {/* Reset form — implemented in Phase 3 */}
      </div>
    </div>
  )
}
