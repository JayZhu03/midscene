import type { z } from '@midscene/core';
import { Form, Input, InputNumber, Select } from 'antd';
import type React from 'react';
import type { ZodRuntimeAccess } from '../../types';
import { t, useUiLanguage } from '../../ui-language';

const { TextArea } = Input;

interface FormFieldProps {
  name: string;
  label: string;
  fieldSchema: z.ZodTypeAny;
  isRequired: boolean;
  isLocateField: boolean;
  marginBottom: number;
  placeholder?: string; // Add optional placeholder prop
}

const renderLabel = (label: string, isOptional: boolean) => {
  return `${label}${isOptional ? t('（可选）') : ''}`;
};

export const TextField: React.FC<Omit<FormFieldProps, 'isLocateField'>> = ({
  name,
  label,
  isRequired,
  marginBottom,
  placeholder: customPlaceholder,
}) => {
  useUiLanguage();

  const placeholder = customPlaceholder || `请输入 ${name}`;
  return (
    <Form.Item
      key={name}
      name={['params', name]}
      label={renderLabel(label, !isRequired)}
      rules={isRequired ? [{ required: true, message: `请填写 ${name}` }] : []}
      style={{ marginBottom }}
      colon={false}
    >
      <Input placeholder={placeholder} />
    </Form.Item>
  );
};

export const LocateField: React.FC<Omit<FormFieldProps, 'isLocateField'>> = ({
  name,
  label,
  isRequired,
  marginBottom,
  placeholder: customPlaceholder,
}) => {
  useUiLanguage();

  const placeholder = customPlaceholder || `用自然语言描述 ${name}`;
  return (
    <Form.Item
      key={name}
      name={['params', name]}
      label={renderLabel(label, !isRequired)}
      rules={
        isRequired
          ? [
              {
                required: true,
                message: `请填写 ${name}`,
              },
            ]
          : []
      }
      style={{ marginBottom }}
      colon={false}
    >
      <TextArea rows={2} placeholder={placeholder} />
    </Form.Item>
  );
};

export const EnumField: React.FC<Omit<FormFieldProps, 'isLocateField'>> = ({
  name,
  label,
  fieldSchema,
  isRequired,
  marginBottom,
  placeholder: customPlaceholder,
}) => {
  useUiLanguage();

  const enumValues = (fieldSchema as ZodRuntimeAccess)._def?.values || [];
  const selectOptions = enumValues.map((value: string) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));

  return (
    <Form.Item
      key={name}
      name={['params', name]}
      label={label}
      rules={isRequired ? [{ required: true, message: `请选择 ${name}` }] : []}
      style={{ marginBottom }}
      colon={false}
    >
      <Select
        placeholder={customPlaceholder || `请选择 ${name}`}
        options={selectOptions}
      />
    </Form.Item>
  );
};

export const NumberField: React.FC<Omit<FormFieldProps, 'isLocateField'>> = ({
  name,
  label,
  isRequired,
  marginBottom,
  placeholder: customPlaceholder,
}) => {
  useUiLanguage();

  const defaultPlaceholder = name === 'distance' ? 500 : 0;
  const placeholderValue = customPlaceholder
    ? Number(customPlaceholder) || defaultPlaceholder
    : defaultPlaceholder;
  const min = 0;
  const max = name === 'distance' ? 10000 : undefined;

  return (
    <Form.Item
      key={name}
      name={['params', name]}
      label={`${label}${name === 'distance' ? ' (px)' : ''}`}
      rules={
        isRequired
          ? [
              { required: true, message: `请填写 ${name}` },
              {
                type: 'number',
                min,
                message: `${label} must be at least ${min}`,
              },
            ]
          : [
              {
                type: 'number',
                min,
                message: `${label} must be at least ${min}`,
              },
            ]
      }
      style={{
        flex: name === 'distance' ? 1 : undefined,
        marginBottom,
      }}
      colon={false}
    >
      <InputNumber
        placeholder={placeholderValue.toString()}
        min={min}
        max={max}
        step={name === 'distance' ? 10 : 1}
        style={{ width: '100%' }}
      />
    </Form.Item>
  );
};

export const BooleanField: React.FC<Omit<FormFieldProps, 'isLocateField'>> = ({
  name,
  label,
  isRequired,
  marginBottom,
  placeholder: customPlaceholder,
}) => {
  useUiLanguage();

  const selectOptions = [
    { value: true, label: t('是（true）') },
    { value: false, label: t('否（false）') },
  ];

  return (
    <Form.Item
      key={name}
      name={['params', name]}
      label={renderLabel(label, !isRequired)}
      rules={isRequired ? [{ required: true, message: `请选择 ${name}` }] : []}
      style={{ marginBottom }}
      colon={false}
    >
      <Select
        placeholder={customPlaceholder || `请选择 ${name}`}
        options={selectOptions}
      />
    </Form.Item>
  );
};
