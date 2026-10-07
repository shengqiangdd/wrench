package main

import "testing"

func TestConfiguredPort(t *testing.T) {
	tests := []struct {
		name    string
		input   int
		want    int
		wantErr bool
	}{
		{name: "default SSH port", input: 0, want: 22},
		{name: "smoke override", input: 22222, want: 22222},
		{name: "minimum port", input: 1, want: 1},
		{name: "maximum port", input: 65535, want: 65535},
		{name: "negative port", input: -1, wantErr: true},
		{name: "port above range", input: 65536, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := configuredPort(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("configuredPort(%d) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("configuredPort(%d) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}
