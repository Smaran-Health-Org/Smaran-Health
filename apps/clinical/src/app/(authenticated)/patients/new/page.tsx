"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { ArrowLeftIcon, PlusIcon } from "@/components/icons";

export default function NewPatientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const body = {
      fullName: form.get("fullName") as string,
      age: form.get("age") ? Number(form.get("age")) : null,
      gender: (form.get("gender") as string) || null,
      phone: (form.get("phone") as string) || null,
      address: (form.get("address") as string) || null,
    };

    const res = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create patient");
      setLoading(false);
      return;
    }

    const patient = await res.json();
    router.push(`/patients/${patient.id}`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-in-up">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          New Patient
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Add a patient to your clinic. Only the name is required.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="fullName">Full name *</Label>
            <Input
              id="fullName"
              name="fullName"
              required
              placeholder="e.g. Ananya Sharma"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="age">Age</Label>
              <Input
                id="age"
                name="age"
                type="number"
                min="0"
                max="150"
                placeholder="e.g. 45"
              />
            </div>
            <div>
              <Label htmlFor="gender">Gender</Label>
              <Select id="gender" name="gender" defaultValue="">
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              placeholder="+91 XXXXX XXXXX"
            />
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              name="address"
              rows={2}
              placeholder="Area or clinic address"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading}>
              <PlusIcon className="h-4 w-4" />
              {loading ? "Creating…" : "Create Patient"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
