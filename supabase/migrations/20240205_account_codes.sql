-- Phase 2: account_codes table (UACS codes in procurements schema)
CREATE TABLE IF NOT EXISTS procurements.account_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  expense_class TEXT NOT NULL
    CHECK (expense_class IN ('PS','MOOE','CO','IG','Others')),
  parent_code_id UUID REFERENCES procurements.account_codes(id),
  level INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_codes_code ON procurements.account_codes(code);
CREATE INDEX idx_account_codes_class ON procurements.account_codes(expense_class);
CREATE INDEX idx_account_codes_parent ON procurements.account_codes(parent_code_id);

-- Seed: Common UACS codes per COA/DBM
INSERT INTO procurements.account_codes (code, name, expense_class, level) VALUES
  -- MOOE
  ('5020101000', 'Travelling Expenses - Local', 'MOOE', 1),
  ('5020201000', 'Training and Scholarship Expenses', 'MOOE', 1),
  ('5020301000', 'Supplies and Materials Expenses', 'MOOE', 1),
  ('5020302000', 'Office Supplies Expense', 'MOOE', 1),
  ('5020303000', 'Accountable Forms Expense', 'MOOE', 1),
  ('5020304000', 'Non-Accountable Forms Expense', 'MOOE', 1),
  ('5020305000', 'Animal/Zoological Supplies Expense', 'MOOE', 1),
  ('5020306000', 'Food Supplies Expense', 'MOOE', 1),
  ('5020307000', 'Drugs and Medicines Expense', 'MOOE', 1),
  ('5020308000', 'Medical, Dental and Laboratory Supplies Expense', 'MOOE', 1),
  ('5020309000', 'Fuel, Oil and Lubricants Expense', 'MOOE', 1),
  ('5020310000', 'Agricultural and Marine Supplies Expense', 'MOOE', 1),
  ('5020311000', 'Textbooks and Instructional Materials Expense', 'MOOE', 1),
  ('5020321000', 'Semi-Expendable Machinery', 'MOOE', 1),
  ('5020322000', 'Semi-Expendable Office Equipment', 'MOOE', 1),
  ('5020323000', 'Semi-Expendable ICT Equipment', 'MOOE', 1),
  ('5020401000', 'Water Expenses', 'MOOE', 1),
  ('5020402000', 'Electricity Expenses', 'MOOE', 1),
  ('5020501000', 'Postage and Courier Services', 'MOOE', 1),
  ('5020502000', 'Telephone Expenses', 'MOOE', 1),
  ('5020503000', 'Internet Subscription Expenses', 'MOOE', 1),
  ('5021001000', 'Professional Services', 'MOOE', 1),
  ('5021002000', 'General Services', 'MOOE', 1),
  ('5021003000', 'Janitorial Services', 'MOOE', 1),
  ('5021004000', 'Security Services', 'MOOE', 1),
  ('5021101000', 'Repair and Maintenance - Buildings and Structures', 'MOOE', 1),
  ('5021103000', 'Repair and Maintenance - Machinery and Equipment', 'MOOE', 1),
  ('5021199000', 'Repair and Maintenance - Other PPE', 'MOOE', 1),
  ('5029901000', 'Advertising Expenses', 'MOOE', 1),
  ('5029902000', 'Printing and Publication Expenses', 'MOOE', 1),
  ('5029903000', 'Representation Expenses', 'MOOE', 1),
  ('5029904000', 'Transportation and Delivery Expenses', 'MOOE', 1),
  ('5029999000', 'Other Maintenance and Operating Expenses', 'MOOE', 1),
  -- Capital Outlay
  ('1060101000', 'Land', 'CO', 1),
  ('1060201000', 'Buildings', 'CO', 1),
  ('1060401000', 'Office Equipment', 'CO', 1),
  ('1060402000', 'ICT Equipment', 'CO', 1),
  ('1060403000', 'Communication Equipment', 'CO', 1),
  ('1060404000', 'Printing Equipment', 'CO', 1),
  ('1060405000', 'Technical and Scientific Equipment', 'CO', 1),
  ('1060501000', 'Motor Vehicles', 'CO', 1),
  ('1060601000', 'Furniture and Fixtures', 'CO', 1),
  ('1060701000', 'Books', 'CO', 1),
  -- PS
  ('5010101000', 'Basic Salary - Civilian', 'PS', 1),
  ('5010201000', 'PERA', 'PS', 1),
  ('5010202000', 'Representation Allowance', 'PS', 1),
  ('5010203000', 'Transportation Allowance', 'PS', 1),
  ('5010204000', 'Clothing/Uniform Allowance', 'PS', 1),
  ('5010205000', 'Subsistence Allowance', 'PS', 1),
  ('5010210000', 'Honoraria', 'PS', 1),
  ('5010213000', 'Overtime and Night Pay', 'PS', 1),
  ('5010301000', 'Life and Retirement Insurance Premiums', 'PS', 1),
  ('5010302000', 'PAG-IBIG Contributions', 'PS', 1),
  ('5010303000', 'PhilHealth Contributions', 'PS', 1),
  ('5010304000', 'ECC Contributions', 'PS', 1)
ON CONFLICT (code) DO NOTHING;
