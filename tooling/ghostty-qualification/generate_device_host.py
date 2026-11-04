#!/usr/bin/env python3
"""Host the unchanged Vibefield terminal suites in an isolated iPhone app.

SwiftPM's generated scheme cannot run tool-hosted tests on iOS hardware. This
generated project mounts the shipping app and compiles the original test files
into app-hosted bundles. It does not edit either checkout or its package graph.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("repo", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("label", choices=["baseline", "candidate"])
parser.add_argument("--team", help="Signing team; defaults to the source app's setting")
parser.add_argument("--bundle-prefix", help="Isolated QA bundle prefix, distinct from the shipping app")
args = parser.parse_args()
repo, destination, label = args.repo.resolve(), args.destination.resolve(), args.label
source = repo / 'apps/ios/VibeField.xcodeproj'
package = repo / 'apps/ios/VibeFieldKit'
destination.mkdir(parents=True, exist_ok=True)
project = destination / 'VibeField.xcodeproj'
project.mkdir(exist_ok=True)
data = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(source / 'project.pbxproj')]))
objects = data['objects']
root = objects[data['rootObject']]
app_id = next(k for k,v in objects.items() if v.get('isa') == 'PBXNativeTarget')
app = objects[app_id]
config_ids = objects[app['buildConfigurationList']]['buildConfigurations']
app_settings = [objects[config]['buildSettings'] for config in config_ids]
# The app permits a side-by-side build through an Xcode setting. Use its
# concrete default rather than carrying the $(...) expression into a QA ID.
production_id = next(setting.get('VIBEFIELD_APP_BUNDLE_IDENTIFIER', setting['PRODUCT_BUNDLE_IDENTIFIER'])
                     for setting in app_settings if 'PRODUCT_BUNDLE_IDENTIFIER' in setting)
team = args.team or next((setting.get('DEVELOPMENT_TEAM') for setting in app_settings if setting.get('DEVELOPMENT_TEAM')), None)
if not team:
    parser.error("The source project has no signing team; supply --team")
bundle_prefix = args.bundle_prefix or production_id + '.ghosttyqualification'
if bundle_prefix == production_id or not bundle_prefix.endswith('.ghosttyqualification'):
    parser.error("The QA bundle prefix must be distinct and end in .ghosttyqualification")

def ident(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def add(name, value):
    key = ident(name)
    assert key not in objects
    objects[key] = value
    return key

for value in objects.values():
    if value.get('isa') == 'PBXGroup' and value.get('path') == 'App':
        value['path'] = str(repo / 'apps/ios/App')
        value['sourceTree'] = '<absolute>'
    if value.get('isa') == 'XCLocalSwiftPackageReference':
        value['relativePath'] = str(package)
    if value.get('isa') == 'XCBuildConfiguration':
        settings = value['buildSettings']
        if 'INFOPLIST_FILE' in settings:
            settings['INFOPLIST_FILE'] = str(repo / 'apps/ios/App/Info.plist')
        if 'PRODUCT_BUNDLE_IDENTIFIER' in settings:
            settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_prefix + '.' + label
            settings['INFOPLIST_KEY_CFBundleDisplayName'] = 'VibeField QA ' + label

scheme = ET.parse(source / 'xcshareddata/xcschemes/VibeField.xcscheme')
action = scheme.getroot().find('TestAction')
action.attrib.pop('shouldAutocreateTestPlan', None)
testables = ET.SubElement(action, 'Testables')
macro = ET.SubElement(action, 'MacroExpansion')
ET.SubElement(macro, 'BuildableReference', BuildableIdentifier='primary', BlueprintIdentifier=app_id,
              BuildableName='VibeField.app', BlueprintName='VibeField', ReferencedContainer='container:VibeField.xcodeproj')
groups = {
    'FieldTerminalTests': ['FieldTerminal', 'FieldRoutedTerminal', 'FieldMesh', 'FieldFreeway', 'GhostteaFontProof'],
    'FieldInputTests': ['FieldInput'],
    'FieldRoutedTerminalTests': ['FieldRoutedTerminal'],
    'FieldFreewayTests': ['FieldFreeway', 'FieldProduct', 'FieldRoutedTerminal'],
    'FieldMeshTests': ['FieldMesh'],
}
for name, products in groups.items():
    test_path = package / 'Tests' / name
    files = []
    refs = []
    sources = sorted(test_path.rglob('*.swift'))
    remote = Path(__file__).resolve().parent / 'GhosttyMigrationRemoteTests.swift'
    if name == 'FieldTerminalTests' and remote.is_file():
        sources.append(remote)
    if (test_path / 'Fixtures').is_dir():
        support = destination / name / 'Bundle+Module.swift'
        support.parent.mkdir(exist_ok=True)
        support.write_text('import Foundation\nprivate final class QualificationBundleAnchor: NSObject {}\nextension Bundle { static var module: Bundle { Bundle(for: QualificationBundleAnchor.self) } }\n')
        sources.append(support)
    for path in sources:
        ref = add(name+str(path), {'isa':'PBXFileReference', 'lastKnownFileType':'sourcecode.swift', 'path':str(path), 'sourceTree':'<absolute>'})
        refs.append(ref)
        files.append(add(name+'build'+str(path), {'isa':'PBXBuildFile', 'fileRef':ref}))
    resources = []
    if (test_path / 'Fixtures').is_dir():
        ref = add(name+'fixtures', {'isa':'PBXFileReference','lastKnownFileType':'folder','path':str(test_path/'Fixtures'),'sourceTree':'<absolute>'})
        refs.append(ref)
        resources.append(add(name+'fixtures-build', {'isa':'PBXBuildFile','fileRef':ref}))
    group = add(name+'group', {'isa':'PBXGroup','children':refs,'name':name,'sourceTree':'<group>'})
    objects[root['mainGroup']]['children'].append(group)
    product = add(name+'product', {'isa':'PBXFileReference','explicitFileType':'wrapper.cfbundle','includeInIndex':0,'path':name+'.xctest','sourceTree':'BUILT_PRODUCTS_DIR'})
    objects[root['productRefGroup']]['children'].append(product)
    dependencies, framework_files = [], []
    for product_name in products:
        dep = add(name+product_name, {'isa':'XCSwiftPackageProductDependency','productName':product_name})
        dependencies.append(dep)
        framework_files.append(add(name+product_name+'link', {'isa':'PBXBuildFile','productRef':dep}))
    phases = []
    for phase, entries in [('Sources',files),('Resources',resources),('Frameworks',framework_files)]:
        phases.append(add(name+phase, {'isa':'PBX'+phase+'BuildPhase','buildActionMask':2147483647,'files':entries,'runOnlyForDeploymentPostprocessing':0}))
    configs = []
    for mode in ['Debug','Release']:
        settings = {
            'BUNDLE_LOADER':'$(TEST_HOST)', 'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/VibeField.app/VibeField',
            'CODE_SIGN_STYLE':'Automatic','DEVELOPMENT_TEAM':team,
            'GENERATE_INFOPLIST_FILE':'YES','IPHONEOS_DEPLOYMENT_TARGET':'18.1',
            'PRODUCT_BUNDLE_IDENTIFIER':bundle_prefix+'.'+label+'.'+name,
            'PRODUCT_NAME':'$(TARGET_NAME)','SDKROOT':'iphoneos','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator',
            'SWIFT_VERSION':'6.0','SWIFT_OPTIMIZATION_LEVEL':'-Onone','ENABLE_TESTABILITY':'YES',
            'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG $(inherited)' + (' GHOSTTY_ROUTED_COPY' if label == 'candidate' else ''),
            'TARGETED_DEVICE_FAMILY':'1,2','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks','@loader_path/Frameworks'],
        }
        configs.append(add(name+mode, {'isa':'XCBuildConfiguration','name':mode,'buildSettings':settings}))
    config_list=add(name+'configs', {'isa':'XCConfigurationList','buildConfigurations':configs,'defaultConfigurationIsVisible':0,'defaultConfigurationName':'Debug'})
    proxy=add(name+'proxy', {'isa':'PBXContainerItemProxy','containerPortal':data['rootObject'],'proxyType':1,'remoteGlobalIDString':app_id,'remoteInfo':'VibeField'})
    dependency=add(name+'host', {'isa':'PBXTargetDependency','target':app_id,'targetProxy':proxy})
    target=add(name+'target', {'isa':'PBXNativeTarget','name':name,'productName':name,'productReference':product,'productType':'com.apple.product-type.bundle.unit-test','buildConfigurationList':config_list,'buildPhases':phases,'buildRules':[],'dependencies':[dependency],'packageProductDependencies':dependencies})
    root['targets'].append(target)
    root.setdefault('attributes',{}).setdefault('TargetAttributes',{})[target]={'TestTargetID':app_id}
    item=ET.SubElement(testables,'TestableReference',skipped='NO',parallelizable='NO')
    ET.SubElement(item,'BuildableReference',BuildableIdentifier='primary',BlueprintIdentifier=target,BuildableName=name+'.xctest',BlueprintName=name,ReferencedContainer='container:VibeField.xcodeproj')

def openstep(value, level=0):
    pad='\t'*level
    if isinstance(value,dict):
        return '{\n'+''.join(pad+'\t'+json.dumps(k)+' = '+openstep(v,level+1)+';\n' for k,v in value.items())+pad+'}'
    if isinstance(value,list):
        return '(\n'+''.join(pad+'\t'+openstep(v,level+1)+',\n' for v in value)+pad+')'
    return json.dumps(value,ensure_ascii=True)

(project/'project.pbxproj').write_text('// !$*UTF8*$!\n'+openstep(data)+'\n')
scheme_path=project/'xcshareddata/xcschemes/VibeField.xcscheme'
scheme_path.parent.mkdir(parents=True,exist_ok=True)
scheme.write(scheme_path,encoding='utf-8',xml_declaration=True)
print(project)

manifest = {
    'repo': str(repo), 'label': label, 'bundleId': bundle_prefix + '.' + label,
    'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
    'sourceDiffSha256': hashlib.sha256(subprocess.check_output(['git', 'diff', 'HEAD', '--binary'], cwd=repo)).hexdigest(),
    'untrackedSwiftSources': {
        name: hashlib.sha256((repo / name).read_bytes()).hexdigest()
        for name in subprocess.check_output(
            ['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', 'apps/ios', 'tooling/ghostty-qualification'],
            cwd=repo, text=True,
        ).split('\0')
        if name.endswith('.swift') and (repo / name).is_file()
    },
    'remoteTestSha256': hashlib.sha256((Path(__file__).parent / 'GhosttyMigrationRemoteTests.swift').read_bytes()).hexdigest(),
}
(destination / 'qualification-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
