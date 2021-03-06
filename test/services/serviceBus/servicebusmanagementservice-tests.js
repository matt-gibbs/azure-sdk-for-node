// 
// Copyright (c) Microsoft and contributors.  All rights reserved.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//   http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// 
// See the License for the specific language governing permissions and
// limitations under the License.
// 

var uuid = require('node-uuid');
var url = require('url');

var util = require('util');
var _ = require('underscore');

var should = require('should');
var mocha = require('mocha');

var testutil = require('../../util/util');
var MockedTestUtils = require('../../framework/mocked-test-utils');

var azure = testutil.libRequire('azure');
var sampledata = require('../../util/sampledata.js');
var namespaceNameIsValid = azure.namespaceNameIsValid;

var testPrefix = 'serviceBusManagement-tests';

describe('Service Bus Management', function () {
  var namespacesToClean = [];
  var namespacesBefore;
  var service;
  var suiteUtil;

  before(function (done) {
    var subscriptionId = process.env['AZURE_SUBSCRIPTION_ID'];
    var auth = { keyvalue: testutil.getCertificateKey(), certvalue: testutil.getCertificate() };
    service = azure.createServiceBusManagementService(
      subscriptionId, auth,
      { serializetype: 'XML'});

    suiteUtil = new MockedTestUtils(service, testPrefix);
    suiteUtil.setupSuite(done);
  });

  after(function (done) {
    suiteUtil.teardownSuite(done);
  });

  beforeEach(function (done) {
    suiteUtil.setupTest(done);
  });

  afterEach(function (done) {
    deleteNamespaces(namespacesToClean, function () {
      suiteUtil.baseTeardownTest(done);
    });
  });

  function newName() {
    return testutil.generateId('nodesdk-', namespacesToClean, suiteUtil.isMocked);
  }

  describe('List Namespaces', function () {
    beforeEach(function (done) {
      service.listNamespaces(function (err, namespaces) {
        namespacesBefore = namespaces;

        done();
      });
    });

    describe('when one namespace is defined', function () {
      var name;
      var region = 'West US';

      beforeEach(function (done) {
        name = newName();

        service.createNamespace(name, region, done);
      })

      it('should return one namespace in the list', function (done) {
        service.listNamespaces(function (err, allNamespaces) {
          should.exist(allNamespaces);
          var namespaces = allNamespaces.filter(function (namespace) {
            return !(namespacesBefore && namespacesBefore.some(function (before) {
              return before.Name === namespace.Name;
            }));
          });

          namespaces[0].Name.should.equal(name);
          namespaces[0].Region.should.equal(region);
          done(err);
        });
      });
    });
  });

  describe('Show namespace', function () {
    describe('namespace name exists', function () {
      it('should return the namespace definition', function (done) {
        var name = newName();
        var region = 'West US';
        service.createNamespace(name, region, function (err, result) {
          if(err) { return done(err); }

          service.getNamespace(name, function (err, namespace) {
            should.not.exist(err);
            should.exist(namespace);
            namespace.Name.should.equal(name);
            namespace.Region.should.equal(region);
            done(err);
          });
        });
      });
    });
  });

  describe('create namespace', function () {
    it('should fail if name is invalid', function (done) {
      service.createNamespace('!notValid$', 'West US', function (err, result) {
        should.exist(err);
        err.message.should.match(/must start with a letter/);
        done();
      });
    });

    it('should succeed if namespace does not exist', function (done) {
      var name = newName();
      var region = 'South Central US';

      service.createNamespace(name, region, function (err, result) {
        should.not.exist(err);
        result.Name.should.equal(name);
        result.Region.should.equal(region);
        done(err);
      });
    });
  });

  describe('delete namespace', function () {
    it('should fail if name is invalid', function (done) {
      service.deleteNamespace('!NotValid$', function (err, result) {
        should.exist(err);
        err.message.should.match(/must start with a letter/);
        done();
      });
    });

    it('should succeed if namespace exists and is activated', function (done) {
      var name = newName();
      var region = 'West US';
      service.createNamespace(name, region, function (err, callback) {
        if (err) { return done(err); }
        waitForNamespaceToActivate(name, function (err) {
          if (err) { return done(err); };

          service.deleteNamespace(name, done);
        });
      });
    });
  });

  describe('Get regions', function() {
    it('should return array of available regions', function (done) {
      service.getRegions(function (err, result) {
        should.exist(result);
        result.should.be.an.instanceOf(Array);
        result.length.should.be.above(0);
        _.each(result, function (region) {
          should.exist(region.Code);
          should.exist(region.FullName);
        });
        done(err);
      });
    });
  });

  describe('verify namespace', function () {
    it('should throw an error if namespace is malformed', function (done) {
      service.verifyNamespace("%$!@%^!", function (err, result) {
        should.exist(err);
        err.message.should.include('must start with a letter');
        done();
      });
    });

    it('should return availability if namespace is properly formed', function (done) {
      var name = newName();
      // Take this name out of the namespaces to clean as no namespace will actually be created
      namespacesToClean.pop();
      service.verifyNamespace(name, function (err, result) {
        should.not.exist(err);
        should.exist(result);
        result.should.be.true;
        done();
      });
    });
  });

  function deleteNamespaces(namespaces, callback) {
    if (namespaces.length === 0) { return callback(); }
    var numDeleted = 0;
    namespaces.forEach(function (namespaceName) {
      service.deleteNamespace(namespaceName, function () {
        ++numDeleted;
        if (numDeleted === namespaces.length) {
          callback();
        }
      });
    });
  }

  function waitForNamespaceToActivate(namespaceName, callback) {
    var poll = function () {
      service.getNamespace(namespaceName, function (err, ns) {
        if (err) { 
          callback(err); 
        } else if (ns.Status === 'Activating') {
          setTimeout(poll, (suiteUtil.isMocked && !suiteUtil.isRecording) ? 0 : 2000);
        } else {
          // Give Azure time to settle down - can't delete immediately after activating
          // without getting a 500 error.
          setTimeout(callback, (suiteUtil.isMocked && !suiteUtil.isRecording) ? 0 : 5000);
        }
      });
    };

    poll();
  }
});