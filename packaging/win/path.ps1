# Adds a folder to the user's PATH, or removes it. Every other entry is kept as written, unexpanded, and the value
# keeps its registry type. The NSIS installer runs this on install and uninstall; -Key exists for testing.
param(
  [Parameter(Mandatory)][ValidateSet('Add', 'Remove')][string]$Action,
  [Parameter(Mandatory)][string]$Dir,
  [string]$Key = 'Environment'
)
$ErrorActionPreference = 'Stop'
$reg = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Key)
try {
  $exists = $reg.GetValueNames() -contains 'Path'
  $current = if ($exists) { [string]$reg.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { '' }
  $kind = if ($exists) { $reg.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  $entries = @($current -split ';' | Where-Object { $_ -ne '' -and $_.TrimEnd('\') -ne $Dir.TrimEnd('\') })
  if ($Action -eq 'Add') { $entries += $Dir }
  $next = $entries -join ';'
  if ($next -ne $current) { $reg.SetValue('Path', $next, $kind) }
} finally {
  $reg.Close()
}
