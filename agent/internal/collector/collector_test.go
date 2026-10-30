package collector

import "testing"

func TestParseCPUInfoIntel(t *testing.T) {
	content := `processor	: 0
vendor_id	: GenuineIntel
model name	: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz
processor	: 1
vendor_id	: GenuineIntel
model name	: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz
`
	model, cores := parseCPUInfo(content)
	if cores != 2 {
		t.Errorf("cores = %d, want 2", cores)
	}
	if model != "Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz" {
		t.Errorf("model = %q", model)
	}
}

func TestParseCPUInfoARMFallbacks(t *testing.T) {
	// Some ARM SoCs have no `model name`; `Processor` (RPi) and `Hardware`
	// (older sunxi) are the lower-quality fallbacks.
	model, cores := parseCPUInfo("Processor       : ARMv7 Processor rev 4 (v7l)\nHardware        : Allwinner sun8i Family\nprocessor       : 0\nprocessor       : 1\nprocessor       : 2\nprocessor       : 3\n")
	if cores != 4 {
		t.Errorf("cores = %d, want 4", cores)
	}
	if model != "ARMv7 Processor rev 4 (v7l)" {
		t.Errorf("model = %q", model)
	}
}

func TestParseCPUInfoEmpty(t *testing.T) {
	model, cores := parseCPUInfo("")
	if model != "" || cores != 0 {
		t.Errorf("got (%q, %d), want empty", model, cores)
	}
}
