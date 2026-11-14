interface Props {
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function NuvemshopWelcomeActivationControl({ enabled, disabled, onChange }: Props) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          role="switch"
          aria-label="Ativar pop-up"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        Ativar pop-up
      </label>
      <p className="mt-2 text-xs leading-relaxed">
        O banco ainda impede a publicação: a campanha precisa permanecer desativada.
        Este controle valida a configuração, mas não liga o pop-up enquanto essa restrição existir.
        A ativação não é feita por ajuste manual no banco.
      </p>
    </div>
  );
}
