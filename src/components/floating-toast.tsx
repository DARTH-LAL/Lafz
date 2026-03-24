type FloatingToastProps = {
  message: string;
  tone: "success" | "error";
};

export function FloatingToast({ message, tone }: FloatingToastProps) {
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm">
      <div
        className={`rounded-[22px] border px-5 py-4 text-sm leading-7 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl ${
          tone === "error"
            ? "border-amber-300/25 bg-amber-300/12 text-amber-100"
            : "border-[rgba(255,45,120,0.25)] bg-[rgba(255,45,120,0.14)] text-[#fff0f6]"
        }`}
      >
        {message}
      </div>
    </div>
  );
}
